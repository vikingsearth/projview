# syntax stress

Gnarly-but-valid markdown, plus one broken inline fence.

## nested everything

> blockquote
> > nested blockquote
> > > triple nested

1. ordered
   1. nested ordered
      - mixed bullet
        ```js
        const deep = "code in a list";
        ```
2. back to top level

## inline html

<details>
<summary>click to expand (raw html)</summary>

Hidden content with a <kbd>Ctrl</kbd>+<kbd>K</kbd> hint.

</details>

## a table with code + pipes

| token | meaning |
| --- | --- |
| `a \| b` | escaped pipe |
| `` `code` `` | literal backticks |

## broken mermaid fence (inline)

The diagram below is malformed - it should become an error card, and the rest
of the page must still render fine:

```mermaid
flowchart TD
  X[ no closing bracket
  X --> Y -->
```

## after the broken fence

This paragraph proves rendering continued past the broken diagram.
