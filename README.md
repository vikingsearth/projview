# projview

a fast, zero-config local viewer for **markdown** + **mermaid** files. run it in
any directory, get a soft-dark cartoonish localhost view of every `.md` / `.mmd`
under it - rendered diagrams, search, live reload - close it and nothing's left
behind.

that's the product. point it at a docs folder, read comfortably, ctrl-c, gone.

## install

```bash
npm i -g projview     # global CLI
# or run without installing:
npx projview
```

## usage

```bash
# try it on the bundled sample docs (no setup needed)
projview --demo

# from the directory you want to browse
projview

# or point it somewhere
projview ./docs --port 5000
projview /path/to/notes --no-open
```

## what you get

| | |
| --- | --- |
| tree nav | every `.md` / `.mmd` under the root (skips `node_modules`, `dist`, dot-dirs) |
| rendering | markdown + syntax-highlighted code + **mermaid diagrams** (with pan/zoom) |
| search | `⌘K` palette - fuzzy filenames + full-text content with line snippets |
| live reload | edit a file, the browser updates |
| ephemeral | in-memory by default; nothing written to disk, nothing left behind |

see [samples/architecture.md](samples/architecture.md) for a mermaid demo.

---

## beyond viewing (optional)

the viewer is the point - everything below is opt-in and entirely ignorable.

### machine interface

subcommands that print JSON to stdout and exit (no server, no browser), if a
script or agent wants to query the same docs:

```bash
projview search "<query>" [path]   # ranked: filename matches + in-content hits w/ line snippets
projview tree [path]               # the file tree as JSON
projview comment add <file> "…"    # leave a comment (--heading <id> to anchor a section)
projview comments [file]           # list comments as JSON
projview usage [path]              # views + searches recorded by the viewer
```

```jsonc
// projview search "live reload"
{ "query": "live reload",
  "files":   [ /* fuzzy filename matches: {path, name, score} */ ],
  "content": [ { "path": "reference/api.md", "count": 4,
                 "snippets": [ { "line": 68, "text": "### live reload" } ] } ] }
```

### comments

notes on a whole file, a heading, or a selected passage - from the viewer (the
💬 button) or the CLI / HTTP API. text comments **re-anchor** as the doc changes
and flag themselves *orphaned* only if the quoted text truly disappears. they
need a persistent store to survive a restart; writes are **localhost-only** (an
exposed instance is read-only).

### persistence

by default the index is in-memory. opt in for a faster warm start, persistent
comments, or a queryable store:

```bash
projview docs --persist                                # sqlite cache in ~/.projview/cache
projview docs --store-url "sqlite:///tmp/docs.sqlite"  # a sqlite file you choose
projview docs --store-url "$DATABASE_URL"              # your own postgres (needs `pg`)
```

| backend | how |
| --- | --- |
| `memory` (default) | _(nothing)_ - ephemeral |
| `lite` (sqlite) | `--persist` |
| `superlite` (JSON) | `--store superlite --persist` |
| `custom` (sqlite/postgres URL) | `--store-url <url>` (or `DATABASE_URL`) |

on re-run it reloads the cache and only re-reads files whose mtime changed.
connection strings come from env/`~/.projview` - never commit credentials.
