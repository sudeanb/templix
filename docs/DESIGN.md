# Templix — Design Document

A compiling template engine: templates parse to an AST, optimize, and
compile into **plain JavaScript functions**. No runtime string parsing, no
eval of data — the only code evaluated is the function generated from the
template author's own template.

## 1. Pipeline

```
template ──parse──▶ node tree ──fold+emit──▶ JS function ──new Function──▶ render(data)
                     │                                          (also: naive tree-walker
                     └──── the same AST drives the naive          for the benchmark)
                           baseline renderer)
```

## 2. Template syntax

| Construct | Meaning |
|---|---|
| `text` | literal, emitted verbatim |
| `{{ expr }}` | output, **auto-escaped** |
| `{{{ expr }}}` | raw output (trusted HTML only; flagged by `analyze()`) |
| `{% if e %}…{% elif e %}…{% else %}…{% endif %}` | conditional |
| `{% each list as item %}…{% endeach %}` | loop; `item`, `@index`, `@first`, `@last` bound in scope |
| `{% include "name" %}` | partial (recursively compiled, depth-limited to 25) |
| `{% set name = expr %}` | scope assignment |

Expressions: literals, identifiers, member/index chains, method calls,
`+ - * / %`, comparisons, `&& || !`, parentheses. Two precedence notes:
`@index`-style at-identifiers are valid; the dialect has no ternary.

## 3. Code generation

The AST walks once and emits statement code over a scope object:

```js
function render($$s) {
  const $$out = [];
  $$out.push("<h1>Order ");
  $$out.push($$esc($$get($$s, ["order"])));
  …
}
```

- `$$get(scope, path)` — undefined-safe member access (no throw on missing)
- `$$esc` — HTML escaping (`& < > " '`)
- member chains compile to a single path array; **method calls** go through
  `$$c(obj, "name", args)` which throws clearly when the method is missing

### Optimizations

1. **Constant folding** — literal-only subexpressions collapse
   (`{{ 2 + 3 }}` becomes a single `push(5)`, no escaping call — numbers
   need none)
2. **Text merging** — adjacent text nodes join into one push
3. (Structural) each-loops are real `for` loops with save/restore of the
   loop variable — no closures allocated per iteration

### Source map

While emitting, every statement records `{ out: generatedLine,
src: templateLine }` in `compile(...).map` — tooling can point an error in
generated code back at the author's template line.

## 4. Security posture

`analyze()` on every compiled template reports:

```js
{ autoEscaped: 5, rawOutputs: 1, xssRisk: true, advice: '…' }
```

Auto-escaping is the default; the ONLY way to emit unescaped HTML is the
explicit `{{{ }}}` form, and every such use is counted and flagged. Data is
never evaluated — expressions reference data, they never execute it.

## 5. The naive baseline

`src/naive.js` walks the same AST interpreting nodes — the classic
"template engine as an interpreter". The benchmark asserts both produce
identical output, then measures the difference: the compiled function is
consistently faster because parsing/folding/dispatch happen once.

```
compiled   51.8ms   (5000 renders, 20-item loop template)
naive      82.0ms
speedup    ~1.6×    — grows with loop body size and static text share
```

## 6. Testing

16 tests: parsing (blocks, elif chains, errors with line numbers),
rendering (if/each/include/set), escaping (the `<script>` case), folding
(code inspection: no `$$g` in a folded push), text merging (single push),
source map validity, naive↔compiled output equality, and `analyze()`
posture. Run with `node --test`.

## 7. Roadmap

- whitespace control (`{%- -%}` trims)
- template inheritance (`{% extends %}`/`{% block %}`)
- escape-context awareness (HTML vs attribute vs JS contexts)
- real source maps (VLQ format) consumed by browser DevTools
