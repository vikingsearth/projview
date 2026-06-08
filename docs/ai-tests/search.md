# search functionality - AI test

An AI-driven test of projview's `search` **machine interface** (`projview search
<query>` → JSON on stdout). The goal: probe distinct behaviours of the engine -
content search, fuzzy filenames, multi-term logic, ranking, and edge cases - by
running the published CLI and inspecting the JSON it returns.

## experimental parameters

| parameter | value |
| --- | --- |
| tool | `projview` (global install) |
| version | `0.4.0` |
| command form | `projview search "<query>" --demo` |
| dataset | the bundled demo docs (`--demo`) - **14 files** at time of test |
| output | JSON: `{ query, files[], content[] }` parsed from stdout |
| ranking | filenames by fuzzy subsequence score; contents by term frequency |

> Note: this very report is the 15th file in the set, so re-running the probes
> below will now also surface `ai-tests/search.md` itself.

## method

Five search terms were chosen, each targeting a different aspect of the engine:

| # | term | aspect under test |
| --- | --- | --- |
| 1 | `live reload` | content search across multiple files + snippet line numbers |
| 2 | `mermaid` | frequency ranking + case-insensitivity (`MERMAID` vs `mermaid`) |
| 3 | `cfg` | fuzzy **filename** match (subsequence), independent of content |
| 4 | `broken diagram` | multi-term **AND** logic + cross-file ranking |
| 5 | `kubernetes` | graceful **no-match** behaviour |

## results

### 1. content search - `live reload`

```bash
projview search "live reload" --demo
```

Three files matched, ranked by frequency, each snippet carrying a line number:

| file | hits | top snippet |
| --- | --- | --- |
| `reference/api.md` | 4 | L68 `### live reload` |
| `diagrams/sequence.mmd` | 2 | L13 `edit a file -> SSE -> live reload` |
| `reference/glossary.md` | 2 | L9 `live reload - SSE-driven refresh` |

✅ Multi-file content search, frequency-ordered, with usable `file:line` citations.

### 2. ranking + case-insensitivity - `mermaid`

`mermaid` returned **8** content matches. Crucially, `MERMAID` (uppercase)
returned the **same 8** - the query is lower-cased before matching.

✅ Case-insensitive; ranked by occurrence count.

### 3. fuzzy filename match - `cfg`

```bash
projview search "cfg" --demo
# files:   ["guides/configuration.md"]
# content: (none)
```

`cfg` is not a substring of any document body, but it **is** a subsequence of
`configuration.md`, so it surfaces in the `files` block while `content` stays empty.

✅ Filename matching is fuzzy (subsequence) and independent of content search.

### 4. multi-term AND + ranking - `broken diagram`

```bash
projview search "broken diagram" --demo
```

| file | hits |
| --- | --- |
| `README.md` | 12 |
| `guides/troubleshooting.md` | 7 |
| `edge-cases/syntax-stress.md` | 6 |
| `guides/configuration.md` | 3 |
| `edge-cases/faulty-refs.md` | 2 |

Only files containing **both** terms appear; ranking is by total term frequency.

✅ Multi-term is a **file-level AND** (every term must appear somewhere in the
file), ranked by combined frequency.

### 5. graceful no-match - `kubernetes`

```bash
projview search "kubernetes" --demo
# { "query": "kubernetes", "files": [], "content": [] }
```

✅ Empty arrays, exit code `0` - a clean "nothing found", not an error.

## observations & limitations

- **Case-insensitive** matching (query is lower-cased).
- **Multi-term = file-level AND**, not phrase match - the words can be anywhere in
  the file, ranked by total frequency.
- **Snippets are first-occurrence**: the shown snippet is the first line containing
  *any* query term, which isn't always the most relevant line for multi-term
  queries. (A future improvement: prefer lines matching the most terms.)
- **Two independent result blocks**: `files` (fuzzy filename) and `content`
  (full-text) - either can be populated without the other.

## reproduce

```bash
npm i -g projview@latest
projview search "live reload" --demo
projview search "cfg" --demo
projview search "broken diagram" --demo
projview search "kubernetes" --demo
projview tree --demo            # list the dataset
```
