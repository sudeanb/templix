# {% Templix %}

**A compiling template engine: templates become plain JavaScript functions —
constant-folded, auto-escaped, source-mapped. Zero dependencies.**

[![CI](https://github.com/sudeanb/templix/actions/workflows/ci.yml/badge.svg)](https://github.com/sudeanb/templix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green)](package.json)

▶ **[Live playground →](https://sudeanb.github.io/templix/)**
(edit the template, see the generated function and the render side by side)

```html
<h1>Order {{ order }} for {{ user.name }}</h1>
<ul>
{% each items as item %}
  <li>{{ item.name }} × {{ item.qty * item.price }}</li>
{% endeach %}
</ul>
{% if admin %}<p>staff order</p>{% endif %}
```

compiles to a function whose body is ordinary JavaScript — `for` loops, a
scope object, an output buffer — with every interpolation routed through
HTML escaping by default.

## What's inside

- **Expression language** — literals, member/index chains, method calls,
  arithmetic, comparisons, `&& || !`, parentheses; parsed by its own
  recursive-descent parser (no `eval`, no `with`)
- **Compiler** — AST → function source via `new Function`; constant
  folding (`{{ 2 + 3 }}` → `push(5)`), adjacent-text merging, source map
  `{ out, src }` per statement
- **Security posture** — `{{ }}` auto-escapes; `{{{ }}}` opts out and is
  counted; `analyze()` reports `autoEscaped / rawOutputs / xssRisk`
- **Includes** — recursive partials with a depth limit, compiled once and
  cached
- **Naive baseline** — the same AST driven by a tree-walking interpreter,
  so the benchmark asserts *equal output* and measures the speedup
  (≈1.6× on a representative template, more with static text)

## Quick start

```bash
git clone https://github.com/sudeanb/templix.git
cd templix
node --test     # 16 tests
```

```js
import { compile } from './src/index.js';

const t = compile('Hello {{ name }}!{% each tags as tag %}[{{ tag }}]{% endeach %}');
t.render({ name: 'World <b>', tags: ['a', 'b'] });
// → 'Hello World &lt;b&gt;![a][b]'
```

## Design decisions worth reading about

[docs/DESIGN.md](docs/DESIGN.md):

- why `{{{ raw }}}` is counted, flagged, and discouraged — and what
  `analyze()` reports
- the interval-free source map (generated line ↔ template line)
- the difference between escaping *output* and trusting *templates*:
  data never executes, template source does

## Limitations (honest list)

- expressions cannot contain the closing delimiters (`}}` inside a string
  literal breaks the tag)
- no whitespace-control trims yet, no template inheritance
- compiled via `new Function` — requires permissive CSP at the render site

## License

[MIT](LICENSE)
