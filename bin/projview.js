#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startServer } from '../src/server.js';
import { buildTree, countFiles } from '../src/walk.js';
import { buildIndex, search } from '../src/search.js';

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

// pick the dir a subcommand runs against: --demo wins, else a positional, else cwd
function rootFrom(positional, args) {
  if (args.includes('--demo')) return DEMO_DIR;
  return positional[0] ? path.resolve(process.cwd(), positional[0]) : process.cwd();
}

async function cmdSearch(args) {
  const positional = args.filter((a) => !a.startsWith('-'));
  const query = positional[0];
  if (!query) {
    console.error('usage: projview search <query> [path] [--demo]');
    process.exit(1);
  }
  const root = rootFrom(positional.slice(1), args);
  await buildIndex(root);
  process.stdout.write(JSON.stringify(search(query), null, 2) + '\n');
}

function cmdTree(args) {
  const positional = args.filter((a) => !a.startsWith('-'));
  const root = rootFrom(positional, args);
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
  -p, --port <n>    preferred port (default: 4321, climbs if taken)
      --demo        preview projview's bundled sample docs
      --no-open     do not auto-open the browser
  -v, --version     print the version and exit
  -h, --help        show this help

nothing is written to disk - ctrl-c and it's gone.`;

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

  const { port, close } = await startServer(opts.root, { port: opts.port, host: opts.host });
  const url = `http://${opts.host}:${port}`;

  console.log(`\n  projview  ->  ${url}`);
  console.log(`  indexing  ->  ${opts.root}`);
  console.log(`  (ctrl-c to stop - nothing is persisted)\n`);

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
