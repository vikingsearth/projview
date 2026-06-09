#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startServer } from '../src/server.js';
import { buildTree, countFiles } from '../src/walk.js';
import { buildIndex, search } from '../src/search.js';
import { resolveStoreConfig, createStore } from '../src/store.js';

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
  projview [path] [options]            start the viewer (default)
  projview search <query> [path]       print ranked search results as JSON
  projview tree [path]                 print the file tree as JSON

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
  -v, --version       print the version and exit
  -h, --help          show this help

ephemeral by default - nothing is persisted unless you opt in with --persist /
--store / --store-url. ctrl-c removes any ephemeral store.`;

async function main() {
  const argv = process.argv.slice(2);

  // machine subcommands -> JSON to stdout, then exit (no server)
  if (argv[0] === 'search') return cmdSearch(argv.slice(1));
  if (argv[0] === 'tree') return cmdTree(argv.slice(1));

  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(VERSION); return; }
  if (opts.unknown) {
    console.error(`projview: unknown option "${opts.unknown}"\nrun "projview --help" for usage.`);
    process.exit(1);
  }

  const storeConfig = resolveStoreConfig(opts);
  const { port, close, storeInfo } = await startServer(opts.root, { port: opts.port, host: opts.host, store: storeConfig });
  const url = `http://${opts.host}:${port}`;

  console.log(`\n  projview  ->  ${url}`);
  console.log(`  indexing  ->  ${opts.root}`);
  console.log(`  store     ->  ${storeInfo.describe}`);
  if (storeInfo.warm) console.log(`  warm      ->  reused cache, reindexed ${storeInfo.reindexed}/${storeInfo.total} changed`);
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
