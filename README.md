# projview

ephemeral local previewer for **markdown** + **mermaid** files. run it in any
directory, get a soft-dark cartoonish localhost view of every `.md` / `.mmd`
under it, close it and nothing's left behind.

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

## use it from scripts or an AI

projview also has a **machine interface** - subcommands that print JSON to stdout
and exit (no server, no browser), so an agent or script can query your docs:

```bash
projview search "<query>" [path]   # ranked: filename matches + in-content hits w/ line snippets
projview tree [path]               # the file tree as JSON
projview comment add <file> "…"    # leave a comment (--heading <id> to anchor a section)
projview comments [file]           # list comments as JSON
projview usage [path]              # views + searches recorded by the viewer
projview search "mermaid" --demo   # quick test on the bundled docs
```

```jsonc
// projview search "live reload"
{ "query": "live reload",
  "files":   [ /* fuzzy filename matches: {path, name, score} */ ],
  "content": [ { "path": "reference/api.md", "count": 4,
                 "snippets": [ { "line": 68, "text": "### live reload" } ] } ] }
```

## what it does

| step | detail |
| --- | --- |
| walk | recursively finds `.md` / `.mmd`, skips `node_modules`, `dist`, dot-dirs |
| index | builds an in-memory tree (nothing written to disk by default) |
| serve | spawns a localhost site + opens your browser |
| live | edits to files reload in the browser automatically |
| comment | leave notes on a file, a section, or a text selection (browser or CLI) |

> ephemeral by default - ctrl-c and it's gone. opt into persistence below.

## comments

Leave notes on a whole file, a heading/section, or a selected passage - from the
viewer (the 💬 button, bottom-right) or via the CLI / HTTP API. Text comments
**re-anchor** as the doc changes and only flag themselves *orphaned* if the quoted
text truly disappears. Comments persist when you opt into a store
(`--persist` / `--store-url`); writes are **localhost-only** (an exposed instance
is read-only).

## persistence (opt-in)

By default the index is in-memory and nothing is written to disk. Opt in for a
faster warm start, or a queryable store an AI can read:

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

On re-run it reloads the cache and only re-reads files whose mtime changed.
Connection strings come from env/`~/.projview` - never commit credentials.

see [samples/architecture.md](samples/architecture.md) for a mermaid demo.
