# comments - AI test

An AI-driven test of projview's **comment machine interface** (`projview comment
add` / `comments` / `comment resolve|rm`, JSON on stdout). The scenario: an agent
reviews a doc set, leaves anchored review notes, and a second reader pulls them
back - no browser involved.

## experimental parameters

| parameter | value |
| --- | --- |
| tool | `projview` (global install) |
| version | `0.8.2` |
| commands | `comment add`, `comments`, `comment resolve`, `comment rm`, `usage` |
| dataset | the bundled demo docs (`--demo`) |
| store | a persistent sqlite file (`--store-url sqlite://…`) - comments need a store |
| output | JSON per comment: `{ id, file, anchor, body, author, createdAt, resolved }` |

> Comments ride a **persistent store**. With the default ephemeral store the
> agent is warned the note won't survive exit, so pass `--persist` or
> `--store-url`.

## method

An agent leaves review notes targeting different anchor types, then the notes are
listed, one resolved, and one deleted:

| # | file | anchor | aspect under test |
| --- | --- | --- | --- |
| 1 | `README.md` | file | whole-file note + agent self-tag (`--author claude`) |
| 2 | `getting-started.md` | heading | section anchor to a stable `pv-` heading id |
| 3 | lifecycle | — | list → resolve → delete over the CLI |

## results

### 1. leave an anchored, agent-tagged comment

```bash
DB="sqlite:///tmp/review.sqlite"
projview comment add README.md "clear intro - add a 'what it is NOT' line" \
  --author claude --store-url "$DB" --demo
```

```jsonc
{ "id": "be15fdb7-…", "file": "README.md",
  "anchor": { "type": "file" },
  "body": "clear intro - add a 'what it is NOT' line",
  "author": "claude", "resolved": false }
```

✅ The agent self-tags via `--author claude`, so AI notes are distinguishable
from human ones. Without `--author`, the author defaults to the git/OS user.

### 2. anchor to a section (heading)

```bash
projview comment add getting-started.md "could link forward to the api reference" \
  --heading pv-headings-h1-h6 --author claude --store-url "$DB" --demo
```

`anchor` becomes `{ "type": "heading", "id": "pv-headings-h1-h6" }`. Heading ids
are the `pv-`-prefixed slugs projview renders, so a section note survives edits to
the section body.

✅ Three anchor flavours exist: `file`, `heading`, and `text` (a quote selector,
created from the viewer - it re-anchors on edits and flags itself *orphaned* only
if the quoted text truly disappears).

### 3. read them back

```bash
projview comments --store-url "$DB" --demo            # all comments, as a JSON array
projview comments README.md --store-url "$DB" --demo  # filtered to one file
```

An agent can diff, summarise, or act on the returned objects programmatically.

### 4. resolve + delete

```bash
projview comment resolve <id> --store-url "$DB" --demo   # -> { …, "resolved": true }
projview comment rm <id>      --store-url "$DB" --demo   # -> { "deleted": "<id>" }
```

✅ Full lifecycle over the CLI: create → list → resolve/reopen → delete. A
missing id exits non-zero with a clear message.

### 5. usage

```bash
projview usage --store-url "$DB" --demo
# { "total": 0, "byType": {}, "topFiles": [], "recentSearches": [] }
```

`usage` is empty here because the **viewer** (not the CLI) records `view` /
`search` events; run the server and browse, then `usage` aggregates what was
looked at.

## observations & limitations

- **Authorship**: explicit `--author` wins; otherwise the git `user.name` (or the
  OS username). UI-created comments default to the server's git/OS user.
- **Persistence is required** for CLI comments to survive - the default store is
  ephemeral and `comment add` warns when it isn't writable beyond the session.
- **Anchors**: `file` and `heading` are creatable from the CLI; `text` quote
  anchors come from the viewer (they need a live text selection).
- **Writes are localhost-only** over HTTP - an exposed (`0.0.0.0`) instance is
  read-only (`403` on write). The CLI writes the store directly, so it isn't gated.

## reproduce

```bash
npm i -g projview@latest
DB="sqlite:///tmp/review.sqlite"
projview comment add README.md "a note" --author claude --store-url "$DB" --demo
projview comments --store-url "$DB" --demo
projview usage --store-url "$DB" --demo
```
