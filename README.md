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

## what it does

| step | detail |
| --- | --- |
| walk | recursively finds `.md` / `.mmd`, skips `node_modules`, `dist`, dot-dirs |
| index | builds an in-memory tree (nothing written to disk) |
| serve | spawns a localhost site + opens your browser |
| live | edits to files reload in the browser automatically |

> ctrl-c and it's gone - "indexing" is never persisted.

see [samples/architecture.md](samples/architecture.md) for a mermaid demo.
