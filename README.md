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
| index | builds an in-memory tree (nothing written to disk) |
| serve | spawns a localhost site + opens your browser |
| live | edits to files reload in the browser automatically |

> ctrl-c and it's gone - "indexing" is never persisted.

see [samples/architecture.md](samples/architecture.md) for a mermaid demo.
