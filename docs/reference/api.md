# api reference

A long document on purpose - enough h2/h3 sections to test the right-side TOC
and scroll-spy (the active section should track as you scroll).

## overview

projview exposes a tiny HTTP surface. It never writes your files - the only
state it records is its own usage events (views / searches) into the store.

## endpoints

### GET /api/tree

Returns the in-memory file tree as JSON, plus the `version` and a `writable`
flag (false when projview is exposed on a non-loopback host).

### GET /api/file

Renders a single file to HTML on demand. Query param `p` is the relative path.
Records a `view` usage event.

### GET /api/events

Server-sent events stream: `change` / `tree` for live reload, `comments` when a
comment is created/edited/deleted.

### GET /api/comments

Lists comments as JSON. Optional `?file=<path>` filters to a single file.

### POST /api/comments

Creates a comment from `{ file, body, anchor?, author? }`. **Loopback only** -
returns `403` when bound to a non-loopback host. Author defaults to the server's
git/OS user when omitted.

### PATCH /api/comments/:id · DELETE /api/comments/:id

Resolve/edit (`{ resolved?, body? }`) or delete a comment. Loopback only.

### GET /api/usage

Aggregated usage: `{ total, byType, topFiles[], recentSearches[] }`.

## machine interface (CLI)

Besides the HTTP server, two subcommands print JSON to stdout and exit - no
server, no browser - for agents and scripts.

### projview search

`projview search "<query>" [path]` returns `{ query, files[], content[] }`.
Filenames match fuzzily (subsequence); contents are ranked by term frequency with
line-numbered snippets. See [the AI search test](../ai-tests/search.md).

### projview tree

`projview tree [path]` returns `{ root, files, tree[] }` - the same structure
`/api/tree` serves.

### projview comment

Leave / manage comments (they ride a persistent store - use `--persist` or
`--store-url`, else you'll be warned the comment won't survive exit):

| command | meaning |
| --- | --- |
| `projview comment add <file> "<body>"` | add a comment (whole file) |
| `projview comment add <file> "<body>" --heading <id>` | anchor it to a section |
| `projview comment resolve\|reopen <id>` | toggle resolved |
| `projview comment rm <id>` | delete it |

`--author <name>` overrides the recorded author (default: git/OS user). Agents
pass e.g. `--author claude` so AI-authored comments are distinguishable. A
comment is `{ id, file, anchor, body, author, createdAt, resolved }`; the
`anchor` is `{type:'file'}`, `{type:'heading', id}`, or a `{type:'text', exact,
prefix, suffix, section}` quote selector (text anchors come from the viewer).

### projview comments

`projview comments [file]` lists comments as JSON - all of them, or just one
file's.

### projview usage

`projview usage [path]` returns `{ total, byType, topFiles[], recentSearches[] }`.
The viewer records a `view` per file opened and a `search` per query, so usage
accumulates over a session (persisted only with a persistent store).

## the walker

### ignored directories

`node_modules`, `dist`, `build`, dot-dirs, and friends are skipped.

### previewable extensions

`.md` and `.mmd` for now. Images and mdx are deferred.

## the renderer

### markdown

markdown-it with highlight.js for fenced code.

### mermaid fences

A ```` ```mermaid ```` fence becomes a div the client renders.

### heading anchors

Every heading gets a slug id; explicit `{#id}` wins when present.

## the server

### static assets

The SPA shell plus vendored mermaid + hljs css.

### path safety

Requested paths are resolved and confined to the root.

## the client

### tree nav

Collapsible dirs, cmd+K search palette, auto-expand on navigate.

### viewer

On-demand fetch + render, in-app link routing, anchor jumps.

### live reload

A chokidar watcher broadcasts change/tree events over SSE.

### comments

A drawer (the 💬 button, bottom-right) lists comments for the open file. Add one
by selecting text, hovering a heading, or "+ note". Text anchors re-anchor on
each render and paint via the CSS Custom Highlight API; create/resolve/delete
controls hide when the server isn't writable.

## stores (persistence)

The index - plus **comments** and **usage events** - is in-memory by default
(ephemeral). Opt into a pluggable store with `--persist` / `--store` /
`--store-url` so comments and usage survive a restart:

### backends

`memory` (default) · `superlite` (JSON) · `lite` (sqlite via `node:sqlite`) ·
`custom` (a `sqlite://` or `postgres://` connection URL; postgres needs the
optional `pg` package).

### warm start

A persisted store lives in `~/.projview/cache`; on re-run projview reloads it and
re-reads only files whose mtime changed. Connection strings come from the
environment / config - never committed.

## performance notes

Indexing is a directory walk; persistence is opt-in (see stores). Search runs
in-memory regardless of backend.

## limitations

No auth, localhost only, single root per process. By design.

## wrap up

If the TOC tracked your scroll position through these sections, scroll-spy works.
