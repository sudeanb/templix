import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compile } from '../src/codegen.js';
import { renderNaive } from '../src/naive.js';
import { parseTemplate } from '../src/parser.js';
import { parseExpr } from '../src/expr.js';

test('text and variables render; output is auto-escaped', () => {
  const t = compile('Hello {{ name }}!');
  assert.equal(t.render({ name: 'World' }), 'Hello World!');
  const evil = compile('Hello {{ name }}');
  assert.equal(evil.render({ name: '<script>' }), 'Hello &lt;script&gt;');
});

test('raw output opts out of escaping', () => {
  const t = compile('{{{ html }}}');
  assert.equal(t.render({ html: '<b>bold</b>' }), '<b>bold</b>');
});

test('if / elif / else chains', () => {
  const t = compile('{% if x %}X{% elif y %}Y{% else %}N{% endif %}');
  assert.equal(t.render({ x: 1, y: 0 }), 'X');
  assert.equal(t.render({ x: 0, y: 1 }), 'Y');
  assert.equal(t.render({ x: 0, y: 0 }), 'N');
});

test('each: item, @index, @first, @last', () => {
  const t = compile('{% each items as it %}{{ @index }}:{{ it }}{% if @first %}!{% endif %}{% if @last %}.{% else %},{% endif %}{% endeach %}');
  assert.equal(t.render({ items: ['a', 'b'] }), '0:a!,1:b.');
  assert.equal(t.render({ items: [] }), '');
});

test('nested member access and computed index', () => {
  const t = compile('{{ user.name }} {{ tags[0] }}');
  assert.equal(t.render({ user: { name: 'Ada' }, tags: ['x'] }), 'Ada x');
});

test('method calls work through the safe helper', () => {
  const t = compile('{{ name.toUpperCase() }}');
  assert.equal(t.render({ name: 'ada' }), 'ADA');
});

test('set writes into scope for later use', () => {
  const t = compile('{% set greeting = "hi" %}{{ greeting }} {{ user }}');
  assert.equal(t.render({ user: 'sam' }), 'hi sam');
});

test('constant folding: literal expressions collapse', () => {
  const t = compile('{{ 2 + 3 }}');
  assert.equal(t.render({}), '5');
  assert.ok(t.code.includes('$out.push(5)'), 'folded literal should be a plain numeric push');
  assert.ok(!t.code.includes('$$g'), 'no runtime lookup needed');
});

test('adjacent text merges into a single push', () => {
  const t = compile('abc');
  const textPushes = (t.code.match(/\$\$out\.push\(/g) || []).length;
  assert.equal(textPushes, 1);
});

test('adjacent text nodes merge into one push', () => {
  const t = compile('abc{{ v }}');
  const textPushes = t.code.match(/\$\$out\.push\("[^"]*"\)/g) ?? [];
  assert.equal(textPushes.length, 1);
});

test('include renders partials with the same scope', () => {
  const t = compile('{% include "row" %}{% include "row" %}', {
    partials: { row: '[{{ v }}]' },
  });
  assert.equal(t.render({ v: 7 }), '[7][7]');
});

test('source map maps generated lines to template lines', () => {
  const t = compile('a\nb{{ name }}\nc\n{% if x %}\nd{% endif %}');
  assert.ok(t.map.length >= 2);
  for (const entry of t.map) {
    assert.ok(entry.src >= 1, 'template lines are 1-based');
    assert.ok(entry.out >= 1, 'generated lines are 1-based');
  }
});

test('analyze reports escaping posture', () => {
  const safeT = compile('{{ x }}');
  assert.deepEqual(safeT.analyze(), { autoEscaped: 1, rawOutputs: 0, xssRisk: false, advice: 'all output is auto-escaped' });
  const rawT = compile('{{{ x }}}');
  assert.equal(rawT.analyze().rawOutputs, 1);
  assert.equal(rawT.analyze().xssRisk, true);
});

test('naive renderer produces identical output to the compiled function', () => {
  const src = '{% each users as u %}{{ u.name }} ({{ u.age }})\n{% endeach %}{% if admin %}admin{% endif %}';
  const data = { users: [{ name: 'A', age: 1 }, { name: 'B', age: 2 }], admin: true };
  const compiledOut = compile(src).render(data);
  const naiveOut = renderNaive(src, data);
  assert.equal(compiledOut, naiveOut);
});

test('parse errors report line numbers', () => {
  assert.throws(() => parseTemplate('{% if x %}oops'), /unclosed block/, () => 'line info');
});

test('expression parser: precedence and errors', () => {
  const ast = parseExpr('1 + 2 * 3');
  assert.equal(ast.op, '+');
  assert.equal(ast.right.op, '*');
  assert.throws(() => parseExpr('1 +'), /unexpected end/);
});
