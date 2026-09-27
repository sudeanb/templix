// The "naive" baseline — tree-walking interpreter of the same AST.
// Exists to measure what compilation buys (see bin/templix.js bench).

import { parseTemplate } from './parser.js';
import { escapeHtml } from './runtime.js';

function evalExpr(node, scope) {
  switch (node.type) {
    case 'num': return node.value;
    case 'str': return node.value;
    case 'true': return true;
    case 'false': return false;
    case 'null': return null;
    case 'ident': return scope[node.name];
    case 'member': {
      const obj = evalExpr(node.obj, scope);
      return obj === null || obj === undefined ? undefined : obj[node.prop.value];
    }
    case 'index': {
      const obj = evalExpr(node.obj, scope);
      return obj === null || obj === undefined ? undefined : obj[evalExpr(node.index, scope)];
    }
    case 'call': {
      if (node.callee.type !== 'member') throw new Error('only obj.method() calls');
      const obj = evalExpr(node.callee.obj, scope);
      const args = node.args.map((a) => evalExpr(a, scope));
      return obj[node.callee.prop.value](...args);
    }
    case 'not': return !evalExpr(node.expr, scope);
    case 'neg': return -evalExpr(node.expr, scope);
    case 'and': {
      const l = evalExpr(node.left, scope);
      return l ? evalExpr(node.right, scope) : l;
    }
    case 'or': {
      const l = evalExpr(node.left, scope);
      return l ? l : evalExpr(node.right, scope);
    }
    case 'bin': {
      const l = evalExpr(node.left, scope);
      const r = evalExpr(node.right, scope);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
        case '%': return l % r;
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
        case '==': return l == r; // eslint-disable-line eqeqeq
        case '!=': return l != r; // eslint-disable-line eqeqeq
        default: throw new Error(`unknown op ${node.op}`);
      }
    }
    default: throw new Error(`cannot evaluate ${node.type}`);
  }
}

/** Render the AST by walking it — no code generation. */
export function renderNaive(source, data, { partials = {} } = {}) {
  const ast = parseTemplate(source);
  const out = [];
  const scope = { ...data };

  const walkBody = (body, depth) => {
    if (depth > 25) throw new Error('include depth exceeded');
    for (const node of body) {
      switch (node.type) {
        case 'text': out.push(node.text); break;
        case 'output': {
          const v = evalExpr(node.expr, scope);
          out.push(node.raw ? String(v) : escapeHtml(v));
          break;
        }
        case 'if': {
          for (const branch of node.branches) {
            const cond = branch.cond === null ? true : evalExpr(branch.cond, scope);
            if (cond !== false && cond !== null && cond !== undefined) {
              walkBody(branch.body, depth);
              break;
            }
          }
          break;
        }
        case 'each': {
          const list = evalExpr(node.list, scope);
          if (Array.isArray(list)) {
            const prev = scope[node.item];
            list.forEach((item, i) => {
              scope[node.item] = item;
              scope['@index'] = i;
              scope['@first'] = i === 0;
              scope['@last'] = i === list.length - 1;
              walkBody(node.body, depth);
            });
            scope[node.item] = prev;
          }
          break;
        }
        case 'include': {
          const partial = partials[node.name];
          if (partial === undefined) throw new Error(`unknown partial '${node.name}'`);
          walkBody(parseTemplate(partial).body, depth + 1);
          break;
        }
        case 'set': scope[node.name] = evalExpr(node.expr, scope); break;
        default: throw new Error(`unknown node ${node.type}`);
      }
    }
  };

  walkBody(ast.body, 0);
  return out.join('');
}
