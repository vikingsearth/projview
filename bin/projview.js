#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { startServer } from '../src/server.js';
import { buildTree, countFiles } from '../src/walk.js';
import { buildIndex, search } from '../src/search.js';
import { resolveStoreConfig, createStore, isPersistent, gitOrOsUser } from '../src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.join(__dirname, '..', 'docs');   // bundled sample docs
const VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

function parseArgs(argv) {
  const opts = {
    root: process.cwd(),
    port: Number(process.env.PORT) || 4321,
    host: process.env.HOST || '127.0.0.1',
    open: true
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') opts.port = Number(argv[++i]) || opts.port;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--demo') opts.demo = true;
    else if (arg === '--store') opts.store = argv[++i];
    else if (arg === '--store-url') opts.storeUrl = argv[++i];
    else if (arg === '--persist') opts.persist = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('-')) opts.unknown = arg;   // unrecognised flag -> error, don't treat as a path
    else rest.push(arg);
  }
  if (rest[0]) opts.root = path.resolve(process.cwd(), rest[0]);
  if (opts.demo) opts.root = DEMO_DIR;
  return opts;
}

// --- machine interface: subcommands that print JSON to stdout and exit ---

// parse subcommand args: separate positionals from flags (consumes flag values,
// so e.g. a postgres:// store URL is never mistaken for a path)
function parseSubArgs(args) {
  const o = { positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--store') o.store = args[++i];
    else if (a === '--store-url') o.storeUrl = args[++i];
    else if (a === '--persist') o.persist = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '--heading') o.heading = args[++i];
    else if (a === '--author') o.author = args[++i];
    else if (a.startsWith('-')) { /* ignore unknown flag in a subcommand */ }
    else o.positional.push(a);
  }
  return o;
}

const subRoot = (o, idx) =>
  o.demo ? DEMO_DIR : (o.positional[idx] ? path.resolve(process.cwd(), o.positional[idx]) : process.cwd());

async function cmdSearch(args) {
  const o = parseSubArgs(args);
  const query = o.positional[0];
  if (!query) {
    console.error('usage: projview search <query> [path] [--demo] [--store <kind>|--store-url <url>] [--persist]');
    process.exit(1);
  }
  const root = subRoot(o, 1);
  const store = createStore(resolveStoreConfig(o), root);
  await buildIndex(root, store);
  process.stdout.write(JSON.stringify(search(query), null, 2) + '\n');
  await store.close();
}

function cmdTree(args) {
  const o = parseSubArgs(args);
  const root = subRoot(o, 0);
  const tree = buildTree(root);
  process.stdout.write(JSON.stringify({ root: path.basename(root) || root, files: countFiles(tree), tree }, null, 2) + '\n');
}

const print = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

// Resolve the comment author: explicit flag > git user.name > OS username.
// Agents pass --author (e.g. "claude") so AI-authored comments are distinguishable.
const resolveAuthor = (explicit) => explicit || gitOrOsUser();

// projview comment <add|resolve|reopen|rm> ...   (writes ride the store)
async function cmdComment(args) {
  const sub = args[0];
  const o = parseSubArgs(args.slice(1));
  const cfg = resolveStoreConfig(o);
  const root = o.demo ? DEMO_DIR : process.cwd();
  const store = createStore(cfg, root);
  try {
    if (sub === 'add') {
      const [file, body] = o.positional;
      if (!file || !body) {
        console.error('usage: projview comment add <file> "<body>" [--heading <id>] [--author <name>] [--persist | --store-url <url>]');
        process.exit(1);
      }
      if (!isPersistent(cfg)) {
        console.error('⚠ no persistent store - this comment will NOT be saved on exit. Re-run with --persist or --store-url <url>.');
      }
      if (!existsSync(path.resolve(root, file))) {
        console.error(`note: "${file}" not found under ${root} - saving the comment anyway.`);
      }
      const anchor = o.heading ? { type: 'heading', id: o.heading } : { type: 'file' };
      print(await store.addComment({ file, body, anchor, author: resolveAuthor(o.author) }));
      return;
    }
    if (sub === 'resolve' || sub === 'reopen') {
      const id = o.positional[0];
      if (!id) { console.error(`usage: projview comment ${sub} <id> [--persist | --store-url <url>]`); process.exit(1); }
      const c = await store.updateComment(id, { resolved: sub === 'resolve' });
      if (!c) { console.error(`no comment with id ${id} in this store`); process.exit(1); }
      print(c);
      return;
    }
    if (sub === 'rm' || sub === 'delete') {
      const id = o.positional[0];
      if (!id) { console.error('usage: projview comment rm <id> [--persist | --store-url <url>]'); process.exit(1); }
      if (!(await store.deleteComment(id))) { console.error(`no comment with id ${id} in this store`); process.exit(1); }
      print({ deleted: id });
      return;
    }
    console.error('usage: projview comment <add|resolve|reopen|rm> ...');
    process.exit(1);
  } finally {
    await store.close();
  }
}

// projview comments [file]   -> list comments (all, or for one file) as JSON
async function cmdComments(args) {
  const o = parseSubArgs(args);
  const root = o.demo ? DEMO_DIR : process.cwd();
  const store = createStore(resolveStoreConfig(o), root);
  const list = await store.listComments(o.positional[0]);
  await store.close();
  print(list);
}

// projview usage [path]   -> aggregated usage stats (views / searches) as JSON
async function cmdUsage(args) {
  const o = parseSubArgs(args);
  const store = createStore(resolveStoreConfig(o), subRoot(o, 0));
  const stats = await store.usageStats();
  await store.close();
  print(stats);
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* no browser, just print the url */ }
}

const HELP = `projview - ephemeral previewer for markdown + mermaid

usage:
  projview [path] [options]                start the viewer (default)
  projview search <query> [path]           print ranked search results as JSON
  projview tree [path]                     print the file tree as JSON
  projview comment add <file> "<text>"     leave a comment (--heading <id> for a section)
  projview comments [file]                 list comments as JSON
  projview comment resolve|reopen|rm <id>  resolve, reopen, or delete a comment
  projview usage [path]                    print usage stats (views / searches) as JSON

  (subcommands print to stdout and exit - no server. --demo works with them too,
   e.g. projview search "websockets" --demo)

arguments:
  path              directory to index (default: current directory)

options:
  -p, --port <n>      preferred port (default: 4321, climbs if taken)
      --demo          preview projview's bundled sample docs
      --no-open       do not auto-open the browser
      --persist       keep the index in ~/.projview/cache and reuse it next run
      --store <kind>  store backend: memory | superlite | lite  (default: memory)
      --store-url <url>  custom store: sqlite://<file> or postgres://<...>  (or set DATABASE_URL)
      --heading <id>  (comment add) anchor the comment to a heading/section id
      --author <name> (comment add) author to record (default: git/OS user)
  -v, --version       print the version and exit
  -h, --help          show this help

ephemeral by default - nothing is persisted unless you opt in with --persist /
--store / --store-url. ctrl-c removes any ephemeral store. Comments + usage need a
persistent store to survive (you'll be warned when adding a comment without one).`;

async function main() {
  const argv = process.argv.slice(2);

  // machine subcommands -> JSON to stdout, then exit (no server)
  if (argv[0] === 'search') return cmdSearch(argv.slice(1));
  if (argv[0] === 'tree') return cmdTree(argv.slice(1));
  if (argv[0] === 'comment') return cmdComment(argv.slice(1));
  if (argv[0] === 'comments') return cmdComments(argv.slice(1));
  if (argv[0] === 'usage') return cmdUsage(argv.slice(1));

  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(VERSION); return; }
  if (opts.unknown) {
    console.error(`projview: unknown option "${opts.unknown}"\nrun "projview --help" for usage.`);
    process.exit(1);
  }

  const storeConfig = resolveStoreConfig(opts);
  const { port, close, storeInfo, writable } = await startServer(opts.root, { port: opts.port, host: opts.host, store: storeConfig });
  const url = `http://${opts.host}:${port}`;

  console.log(`\n  projview  ->  ${url}`);
  console.log(`  indexing  ->  ${opts.root}`);
  console.log(`  store     ->  ${storeInfo.describe}`);
  if (storeInfo.warm) console.log(`  warm      ->  reused cache, reindexed ${storeInfo.reindexed}/${storeInfo.total} changed`);
  if (!writable) console.log(`  comments  ->  read-only (exposed on ${opts.host})`);
  console.log(`  (ctrl-c to stop)\n`);

  if (opts.open) openBrowser(url);

  const shutdown = async () => {
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('projview failed to start:', err.message);
  process.exit(1);
});
