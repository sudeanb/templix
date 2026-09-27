// Templix expression parser — the little language inside {{ }} and {% %}.
//
// Precedence (loose → tight): ||  &&  == !=  < <= > >=  + -  * / %  unary
// Primary: numbers, strings, true/false/null, identifiers, member access
// (a.b, a["b"]), calls (f(x)), parentheses.

export class ExprError extends Error {
  constructor(message, pos) {
    super(`${message} at ${pos}`);
    this.pos = pos;
  }
}

const KEYWORDS = new Set(['true', 'false', 'null']);

export function parseExpr(src) {
  let i = 0;
  const peek = () => src[i];
  const eat = (s) => {
    if (src.startsWith(s, i)) { i += s.length; return true; }
    return false;
  };

  function skipWs() { while (i < src.length && /\s/.test(src[i])) i++; }

  function primary() {
    skipWs();
    const start = i;
    const c = peek();
    if (c === undefined) throw new ExprError('unexpected end of expression', start);
    if (/[0-9]/.test(c)) {
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      return { type: 'num', value: Number(src.slice(start, i)) };
    }
    if (c === '"' || c === "'") {
      i++;
      let s = '';
      while (i < src.length && src[i] !== c) { s += src[i]; i++; }
      if (i >= src.length) throw new ExprError('unterminated string', start);
      i++;
      return { type: 'str', value: s };
    }
    if (/[A-Za-z_$@]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_$@]/.test(src[i])) i++;
      const name = src.slice(start, i);
      if (KEYWORDS.has(name)) return { type: name };
      return { type: 'ident', name };
    }
    if (c === '(') {
      i++;
      const inner = expr();
      skipWs();
      if (!eat(')')) throw new ExprError("expected ')'", i);
      return inner;
    }
    if (c === '!') { i++; return { type: 'not', expr: unary() }; }
    if (c === '-') { i++; return { type: 'neg', expr: unary() }; }
    throw new ExprError(`unexpected '${c}'`, start);
  }

  function postfix(base) {
    let node = base;
    while (true) {
      skipWs();
      if (eat('.')) {
        skipWs();
        const start = i;
        while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
        if (i === start) throw new ExprError('expected property name', start);
        node = { type: 'member', obj: node, prop: { type: 'str', value: src.slice(start, i) } };
        continue;
      }
      if (peek() === '[') {
        i++;
        const idx = expr();
        skipWs();
        if (!eat(']')) throw new ExprError("expected ']'", i);
        node = { type: 'index', obj: node, index: idx };
        continue;
      }
      if (peek() === '(') {
        i++;
        const args = [];
        skipWs();
        if (peek() !== ')') {
          while (true) {
            args.push(expr());
            skipWs();
            if (eat(',')) { skipWs(); continue; }
            break;
          }
        }
        if (!eat(')')) throw new ExprError("expected ')'", i);
        node = { type: 'call', callee: node, args };
        continue;
      }
      break;
    }
    return node;
  }

  function unary() {
    skipWs();
    if (peek() === '!') { i++; return { type: 'not', expr: unary() }; }
    if (peek() === '-') { i++; return { type: 'neg', expr: unary() }; }
    return postfix(primary());
  }

  const LEVELS = [
    { ops: ['||'], type: 'or' },
    { ops: ['&&'], type: 'and' },
    { ops: ['==', '!='], type: 'bin' },
    { ops: ['<', '<=', '>', '>='], type: 'bin' },
    { ops: ['+', '-'], type: 'bin' },
    { ops: ['*', '/', '%'], type: 'bin' },
  ];

  function binary(level) {
    if (level >= LEVELS.length) return unary();
    const { ops, type } = LEVELS[level];
    let left = binary(level + 1);
    while (true) {
      skipWs();
      const op = ops.find((o) => src.startsWith(o, i) && !src.startsWith(o + '=', i));
      if (!op) break;
      i += op.length;
      const right = binary(level + 1);
      left = type === 'bin' ? { type: 'bin', op, left, right } : { type, left, right };
    }
    return left;
  }

  function expr() { return binary(0); }

  const node = expr();
  skipWs();
  if (i < src.length) throw new ExprError(`trailing input '${src.slice(i, i + 10)}'`, i);
  return node;
}
