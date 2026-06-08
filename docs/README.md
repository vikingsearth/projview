# projview test docs

a deliberately mixed doc set - **most of it should render perfectly**, and a
few files contain **intentional breakage** so we can test how projview handles
faults. use this tree while iterating on the tool.

## index

| area | doc | what it exercises |
| --- | --- | --- |
| **setup** | [**how to set up**](how-to-set-up.md) | install / clone / use as a library + links to the repo & npm |
| start | [getting started](getting-started.md) | headings h1-h6, code, tables, anchors, a valid diagram |
| guides | [installation](guides/installation.md) | relative links up/down, one dead link |
| guides | [configuration](guides/configuration.md) | explicit `{#id}` anchors, a missing-anchor link |
| guides | [troubleshooting](guides/troubleshooting.md) | a link to a file that doesn't exist |
| diagrams | [architecture](diagrams/architecture.mmd) | standalone valid flowchart |
| diagrams | [sequence](diagrams/sequence.mmd) | standalone valid sequence |
| diagrams | [broken diagram](diagrams/broken-diagram.mmd) | **invalid mermaid** - error card test |
| reference | [api](reference/api.md) | long doc - TOC + scroll-spy |
| reference | [glossary](reference/glossary.md) | cross-links + external links |
| edge | [syntax stress](edge-cases/syntax-stress.md) | gnarly markdown + inline broken fence |
| edge | [faulty refs](edge-cases/faulty-refs.md) | **several dead links** on purpose |
| edge | [buried file](edge-cases/deep/nested/buried.md) | deep nesting - indentation + auto-expand |
| ai-tests | [search test](ai-tests/search.md) | AI-run test of the `projview search` machine interface |

## intentional faults (should NOT crash the app)

- a dead link right here: [this file is missing](does-not-exist.md)
- an external link: [anthropic](https://www.anthropic.com)
- a link to a missing anchor: [no such section](#nope)
