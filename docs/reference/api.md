# api reference

A long document on purpose - enough h2/h3 sections to test the right-side TOC
and scroll-spy (the active section should track as you scroll).

## overview

projview exposes a tiny HTTP surface. Everything is read-only and in-memory.

## endpoints

### GET /api/tree

Returns the in-memory file tree as JSON.

### GET /api/file

Renders a single file to HTML on demand. Query param `p` is the relative path.

### GET /api/events

Server-sent events stream for live reload.

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

## performance notes

Indexing is just a directory walk - no persistence, no cache files.

## limitations

No auth, localhost only, single root per process. By design.

## wrap up

If the TOC tracked your scroll position through these sections, scroll-spy works.
