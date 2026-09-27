// Templix codegen — AST → a plain JavaScript render function.
//
// The generated body is ordinary statement code operating on a scope
// object ($$s = shallow copy of the data): loops are real for-loops,
// output is $$out.push(...), expressions go through undefined-safe
// helpers ($$g = get, $$c = call-method). No eval of user data — the
// FUNCTION source is derived from the template author's own template.
//
// Optimizations before emission:
//   • adjacent text nodes merge into a single push
//   • literal-only subexpressions fold (e.g. {{ 2 + 3 }} → push "5")
//
// A source map [{ out, src }] maps generated body lines to template lines.

import { parseTemplate } from './parser.js';
import { escapeHtml } from './runtime.js';

const lit = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

// ---- constant folding ----

function fold(node) {
  if (node.type === 'bin') {
    const left = fold(node.left);
    const right = fold(node.right);
    if (left.type === 'num' && right.type === 'num' && ['+', '-', '*', '/', '%'].includes(node.op)) {
      const v = {
        '+': left.value + right.value,
        '-': left.value - right.value,
        '*': left.value * right.value,
        '/': right.value ? left.value / right.value : NaN,
        '%': right.value ? left.value % right.value : NaN,
      }[node.op];
      return { type: 'num', value: v };
    }
    if (left.type === 'str' && right.type === 'str' && node.op === '+') {
      return { type: 'str', value: left.value + right.value };
    }
    return { ...node, left, right };
  }
  if (node.type === 'neg') {
    const inner = fold(node.expr);
    if (inner.type === 'num') return { type: 'num', value: -inner.value };
    return { ...node, expr: inner };
  }
  if (node.type === 'not') return { ...node, expr: fold(node.expr) };
  if (node.type === 'member') return { ...node, obj: fold(node.obj) };
  if (node.type === 'index') return { ...node, obj: fold(node.obj), index: fold(node.index) };
  if (node.type === 'call') return { ...node, callee: fold(node.callee), args: node.args.map(fold) };
  return node;
}

// ---- expression → JS source ----

function exprToJs(node) {
  switch (node.type) {
    case 'num': return String(node.value);
    case 'str': return JSON.stringify(node.value);
    case 'true': return 'true';
    case 'false': return 'false';
    case 'null': return 'null';
    case 'ident': return `$$g($$s, ${JSON.stringify(node.name)})`;
    case 'member':
      return `$$g(${exprToJs(node.obj)}, ${JSON.stringify(node.prop.value)})`;
    case 'index':
      return `$$g(${exprToJs(node.obj)}, ${exprToJs(node.index)})`;
    case 'call': {
      if (node.callee.type !== 'member') {
        throw new Error('only method calls (obj.method(...)) are supported');
      }
      return `$$c(${exprToJs(node.callee.obj)}, ${JSON.stringify(node.callee.prop.value)}, [${node.args.map(exprToJs).join(', ')}])`;
    }
    case 'not': return `(!${exprToJs(node.expr)})`;
    case 'neg': return `(-${exprToJs(node.expr)})`;
    case 'and': return `(${exprToJs(node.left)} && ${exprToJs(node.right)})`;
    case 'or': return `(${exprToJs(node.left)} || ${exprToJs(node.right)})`;
    case 'bin': return `(${exprToJs(node.left)} ${node.op} ${exprToJs(node.right)})`;
    default: throw new Error(`cannot compile expression '${node.type}'`);
  }
}

// ---- body → statements ----

function genBody(body, map, stats) {
  let code = '';
  let textBuffer = '';
  let textLine = null;

  const flushText = () => {
    if (textBuffer.length) {
      code += `  $$out.push(${JSON.stringify(textBuffer)});\n`;
      map.push({ out: ++map.line, src: textLine });
      textBuffer = '';
    }
  };

  for (const node of body) {
    if (node.type === 'text') {
      if (!textBuffer.length) textLine = node.line;
      textBuffer += node.text;
      stats.text++;
      continue;
    }
    flushText();
    const srcLine = node.line;
    switch (node.type) {
      case 'output': {
        stats.output++;
        if (node.raw) stats.outputRaw++;
        const folded = fold(node.expr);
        // folded numeric constants are exact — no escaping wrapper needed
        if (folded.type === 'num') {
          code += `  $$out.push(${folded.value});\n`;
        } else {
          const js = exprToJs(folded);
          code += `  $$out.push(${node.raw ? js : `$$esc(${js})`});\n`;
        }
        map.push({ out: ++map.line, src: srcLine });
        break;
      }
      case 'if': {
        stats.if++;
        let first = true;
        for (const branch of node.branches) {
          map.push({ out: ++map.line, src: branch.line ?? srcLine });
          code += first
            ? `  if (${exprToJs(branch.cond)}) {\n`
            : branch.cond === null
              ? `  } else {\n`
              : `  } else if (${exprToJs(branch.cond)}) {\n`;
          map.line += 0;
          code += genBody(branch.body, map, stats);
          first = false;
        }
        code += '  }\n';
        map.line += 1;
        break;
      }
      case 'each': {
        stats.each++;
        map.push({ out: ++map.line, src: srcLine });
        code += `  { const $$list = ${genExprAsKey(node.list)};\n`;
        code += `    if (Array.isArray($$list)) {\n`;
        code += `      const $$prevItem = $$s[${JSON.stringify(node.item)}];\n`;
        code += `      for (let $$i = 0; $$i < $$list.length; $$i++) {\n`;
        code += `        $$s[${JSON.stringify(node.item)}] = $$list[$$i];\n`;
        code += `        $$s['@index'] = $$i; $$s['@first'] = $$i === 0; $$s['@last'] = $$i === $$list.length - 1;\n`;
        code += genBody(node.body, map, stats);
        code += `      }\n`;
        code += `      $$s[${JSON.stringify(node.item)}] = $$prevItem;\n`;
        code += `    }\n  }\n`;
        map.line += 8;
        break;
      }
      case 'include': {
        stats.include++;
        code += `  $$inc(${JSON.stringify(node.name)}, $$s, $$out);\n`;
        map.push({ out: ++map.line, src: srcLine });
        break;
      }
      case 'set': {
        stats.set++;
        code += `  $$s[${JSON.stringify(node.name)}] = ${exprToJs(node.expr)};\n`;
        map.push({ out: ++map.line, src: srcLine });
        break;
      }
      default:
        throw new Error(`codegen: unknown node '${node.type}'`);
    }
  }
  flushText();
  return code;
}

// {{ each xs }} list expression is compiled via the standard path, but
// genExprAsKey exists to make the intent explicit (it emits the same JS).
function genExprAsKey(node) {
  return exprToJs(node);
}

/**
 * Compile a template into a render function.
 * Returns { render(data), code, map, stats, analyze }.
 */
export function compile(source, { partials = {}, name = 'template', depth = 0 } = {}) {
  if (depth > 25) throw new Error('include depth exceeded (recursive partials?)');
  const ast = parseTemplate(source);
  const map = [];
  map.line = 2; // body starts after the 2-line function prelude
  const stats = { text: 0, output: 0, outputRaw: 0, if: 0, each: 0, include: 0, set: 0 };

  const body = genBody(ast.body, map, stats);

  const code =
    `function render($$s) {\n` +
    `  const $$out = [];\n` +
    body +
    `  return $$out.join('');\n` +
    `}`;

  const includeCache = new Map();
  const includeDepth = { n: depth };
  const helpers = {
    esc: escapeHtml,
    g: (obj, key) => (obj === null || obj === undefined ? undefined : obj[key]),
    c: (obj, method, args) => {
      if (obj === null || obj === undefined) throw new TypeError(`cannot call .${method}() of ${obj}`);
      if (typeof obj[method] !== 'function') throw new TypeError(`.${method} is not a function`);
      return obj[method](...args);
    },
    inc: (partialName, scope, out) => {
      if (includeDepth.n >= 25) throw new Error('include depth exceeded (recursive partials?)');
      let compiled = includeCache.get(partialName);
      if (compiled === undefined) {
        const src = partials[partialName];
        if (src === undefined) throw new Error(`unknown partial '${partialName}'`);
        compiled = compile(src, { partials, name: partialName, depth: includeDepth.n + 1 });
        includeCache.set(partialName, compiled);
      }
      out.push(compiled.render(scope));
    },
  };

  const factory = new Function('$$esc', '$$g', '$$c', '$$inc', `${code}\nreturn render;`);
  const renderFn = factory(helpers.esc, helpers.g, helpers.c, helpers.inc);

  function render(data) {
    const scope = { ...data };
    return renderFn(scope);
  }

  return {
    render,
    code,
    map,
    stats,
    ast,
    analyze: () => ({
      autoEscaped: stats.output - stats.outputRaw,
      rawOutputs: stats.outputRaw,
      xssRisk: stats.outputRaw > 0,
      advice: stats.outputRaw
        ? 'raw outputs bypass escaping — only for trusted HTML'
        : 'all output is auto-escaped',
    }),
  };
}
