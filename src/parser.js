// Templix template parser — source → node tree.
//
// Syntax:
//   {{ expression }}               auto-escaped output
//   {{{ expression }}}             raw output (opt-out of escaping)
//   {% if e %} … {% elif e %} … {% else %} … {% endif %}
//   {% each xs as item %} … {% endeach %}     (item, @index, @first, @last)
//   {% include "name" %}           partial
//   {% set name = expr %}
// Everything outside tags is literal text.
//
// Scanner: single left-to-right pass with indexOf — deterministic and easy
// to reason about. Expressions may not contain the closing delimiter.

import { parseExpr } from './expr.js';

export class TemplateError extends Error {
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.line = line;
  }
}

const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

// if-block stack marker: text after {% if %}/{% elif %}/{% else %} lands in
// the CURRENT branch's body — the getter always follows the newest branch
const makeMarker = (ifNode) => ({
  type: 'if-branch',
  final: false,
  ifNode,
  get body() { return ifNode.branches[ifNode.branches.length - 1].body; },
});

export function parseTemplate(source) {
  const root = { type: 'root', body: [] };
  const stack = [root];
  let pos = 0;

  const top = () => stack[stack.length - 1];
  const push = (node) => top().body.push(node);

  function textUntil(stop) {
    if (stop > pos) {
      const text = source.slice(pos, stop);
      const line = lineOf(source, pos);
      push({ type: 'text', text, line });
    }
  }

  while (pos < source.length) {
    const openRaw = source.indexOf('{{{', pos);
    const openOut = source.indexOf('{{', pos);
    const openBlock = source.indexOf('{%', pos);

    // pick the earliest opener ({{{ wins over {{ at the same offset)
    let kind = null, open = -1;
    const candidates = [];
    if (openRaw !== -1) candidates.push([openRaw, 'raw']);
    if (openOut !== -1 && openOut !== openRaw) candidates.push([openOut, 'out']);
    if (openBlock !== -1) candidates.push([openBlock, 'block']);
    candidates.sort((a, b) => a[0] - b[0]);
    if (!candidates.length) { textUntil(source.length); break; }
    [open, kind] = candidates[0];

    textUntil(open);
    const line = lineOf(source, open);

    if (kind === 'raw' || kind === 'out') {
      const closeTag = kind === 'raw' ? '}}}' : '}}';
      const bodyStart = open + (kind === 'raw' ? 3 : 2);
      const close = source.indexOf(closeTag, bodyStart);
      if (close === -1) throw new TemplateError('unclosed output tag', line);
      const inner = source.slice(bodyStart, close).trim();
      if (kind === 'out' && inner.startsWith('{')) {
        // user wrote {{{x}}} but we matched {{ … — put the extra brace back
        pos = open + 2;
        push({ type: 'text', text: '{', line });
        continue;
      }
      push({ type: 'output', expr: parseExpr(inner), raw: kind === 'raw', line });
      pos = close + closeTag.length;
      continue;
    }

    // block tag {% … %}
    const close = source.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError('unclosed block tag', line);
    const inner = source.slice(open + 2, close).replace(/^-/, '').replace(/-$/, '').trim();
    pos = close + 2;

    const kwMatch = inner.match(/^(\w+)\b/);
    const kw = kwMatch ? kwMatch[1] : '';
    const rest = inner.slice(kw.length).trim();

    if (kw === 'if') {
      const node = { type: 'if', branches: [{ cond: parseExpr(rest), body: [] }], line };
      push(node);
      stack.push(makeMarker(node));
    } else if (kw === 'elif') {
      const marker = top();
      if (marker.type !== 'if-branch' || marker.final) throw new TemplateError('{% elif %} without {% if %}', line);
      marker.final = true;
      marker.ifNode.branches.push({ cond: parseExpr(rest), body: [] });
      stack[stack.length - 1] = makeMarker(marker.ifNode);
    } else if (kw === 'else') {
      const marker = top();
      if (marker.type !== 'if-branch' || marker.final) throw new TemplateError('{% else %} without {% if %}', line);
      marker.final = true;
      marker.ifNode.branches.push({ cond: null, body: [] });
      stack[stack.length - 1] = makeMarker(marker.ifNode);
    } else if (kw === 'endif') {
      if (top().type !== 'if-branch') throw new TemplateError('{% endif %} without {% if %}', line);
      stack.pop();
    } else if (kw === 'each') {
      const mm = rest.match(/^(\w+)\s+as\s+(\w+)$/);
      if (!mm) throw new TemplateError('each needs: each list as item', line);
      const node = { type: 'each', list: parseExpr(mm[1]), item: mm[2], body: [], line };
      push(node);
      stack.push(node);
    } else if (kw === 'endeach') {
      if (top().type !== 'each') throw new TemplateError('{% endeach %} without {% each %}', line);
      stack.pop();
    } else if (kw === 'include') {
      const mm = rest.match(/^"([^"]+)"$/);
      if (!mm) throw new TemplateError('include needs a quoted partial name', line);
      push({ type: 'include', name: mm[1], line });
    } else if (kw === 'set') {
      const mm = rest.match(/^(\w+)\s*=\s*([\s\S]+)$/);
      if (!mm) throw new TemplateError('set needs: set name = expression', line);
      push({ type: 'set', name: mm[1], expr: parseExpr(mm[2]), line });
    } else {
      throw new TemplateError(`unknown tag '{% ${kw || inner} %}'`, line);
    }
  }

  if (stack.length !== 1) throw new TemplateError('unclosed block at end of template', lineOf(source, source.length));
  return root;
}
