# how to set up projview

Everything you need to **install, run, or hack on** projview - a tiny local
previewer for markdown + mermaid files.

- 📦 npm: <https://www.npmjs.com/package/projview>
- 🐙 repo: <https://github.com/vikingsearth/projview>
- 🐛 issues: <https://github.com/vikingsearth/projview/issues>

## requirements

| need | version |
| --- | --- |
| Node.js | **18+** |
| npm | ships with Node |

No build step, no database - indexing is in-memory and nothing is written to disk.

## pick your path

```mermaid
flowchart TD
  Q{what do you want to do?}
  Q -->|just try it, zero install| A["npx projview --demo"]
  Q -->|preview my own docs often| B["npm i -g projview"]
  Q -->|modify it / contribute| C["clone the repo"]
  A --> R[browser opens on a local port]
  B --> R
  C --> R
```

## 1. run instantly with npx (no install)

```bash
# preview the bundled sample docs (this very doc set)
npx projview --demo

# preview the current directory
npx projview

# point it somewhere, on a chosen port, without auto-opening the browser
npx projview ./docs --port 5000 --no-open
```

`npx` downloads + runs the latest published version, then cleans up.

## 2. install the CLI globally

```bash
npm i -g projview     # adds `projview` to your PATH
projview --demo       # try the sample docs
projview ~/notes      # preview any directory
```

To update later: `npm i -g projview@latest`. To remove: `npm rm -g projview`.

## 3. clone the repo + run from source

For hacking on projview itself, or running an unpublished build:

```bash
git clone https://github.com/vikingsearth/projview.git
cd projview
npm install

npm run demo                 # preview the bundled docs/  (alias for --demo)
npm start                    # index the current directory
node bin/projview.js ./docs  # or call the CLI directly
npm test                     # run the test suite (node:test, 23 tests)
```

See the [project README](README.md) for the architecture and the
[api reference](reference/api.md) for the HTTP surface.

## CLI reference

| argument / flag | meaning |
| --- | --- |
| `[path]` | directory to index (default: current directory) |
| `--demo` | preview projview's own bundled sample docs |
| `-p`, `--port <n>` | preferred port (default `4321`, climbs if taken) |
| `--no-open` | don't auto-open the browser |
| `-h`, `--help` | show help |

**Environment variables** (handy for containers / servers):

| var | default | use |
| --- | --- | --- |
| `PORT` | `4321` | port to serve on |
| `HOST` | `127.0.0.1` | interface to bind (`0.0.0.0` to expose) |

## use the source directly (advanced)

The server is a small ES module you can embed. There's no stable public API yet,
so treat this as internal:

```js
import { startServer } from 'projview/src/server.js';

const { port, close } = await startServer(process.cwd(), { port: 4321, host: '127.0.0.1' });
console.log(`serving on http://127.0.0.1:${port}`);
// ... later
await close();
```

The client is plain ES modules under `public/` (`main.js` wires it together) -
no bundler, so you can read and tweak it directly.

## run it as a container (optional)

The repo ships a `Dockerfile` that serves the demo docs on port `8080`:

```bash
docker build -t projview-demo .
docker run -p 8080:8080 projview-demo   # then open http://localhost:8080
```

> Behind a TLS-intercepting proxy? Pass your corporate CA as a build secret:
> `docker build --secret id=cacert,src=corp-ca.pem -t projview-demo .` - the
> cert is used only during install and never written into an image layer.

## links & references

| | |
| --- | --- |
| repository | <https://github.com/vikingsearth/projview> |
| npm package | <https://www.npmjs.com/package/projview> |
| report a bug | <https://github.com/vikingsearth/projview/issues> |
| license | MIT |
| more docs | [getting started](getting-started.md) · [api reference](reference/api.md) · [glossary](reference/glossary.md) |
