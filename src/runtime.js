// Templix runtime helpers — injected into every compiled template as
// $$esc / $$get / $$ix / $$call / $$inc. No globals are touched.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Undefined-safe deep property read: $$get(ctx, ["user", "name"]). */
export function get(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function ix(obj, key) {
  if (obj === null || obj === undefined) return undefined;
  return obj[key];
}

export function call(obj, method, args) {
  if (obj === null || obj === undefined) throw new TypeError(`cannot call .${method}() of ${obj}`);
  const fn = obj[method];
  if (typeof fn !== 'function') throw new TypeError(`.${method} is not a function`);
  return fn.apply(obj, args);
}
