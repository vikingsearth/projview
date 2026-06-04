#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.join(__dirname, '..', 'docs');   // bundled sample docs

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
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else rest.push(arg);
  }
  if (rest[0]) opts.root = path.resolve(process.cwd(), rest[0]);
  if (opts.demo) opts.root = DEMO_DIR;
  return opts;
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
  projview [path] [options]

arguments:
  path              directory to index (default: current directory)

options:
  -p, --port <n>    preferred port (default: 4321, climbs if taken)
      --demo        preview projview's bundled sample docs
      --no-open     do not auto-open the browser
  -h, --help        show this help

nothing is written to disk - ctrl-c and it's gone.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
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
