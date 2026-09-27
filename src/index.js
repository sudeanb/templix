// templix — public API.

import { parseTemplate, TemplateError } from './parser.js';
import { parseExpr, ExprError } from './expr.js';
import { compile } from './codegen.js';
import { renderNaive } from './naive.js';
import { escapeHtml } from './runtime.js';

export { parseTemplate, TemplateError };
export { parseExpr, ExprError };
export { compile };
export { renderNaive };
export { escapeHtml };

export const VERSION = '0.1.0';

/**
 * Benchmark helper: compiled function vs naive tree-walk on the same
 * template/data. Returns { compiledMs, naiveMs, speedup, equal }.
 */
export function bench(source, data, { iterations = 2000, partials = {} } = {}) {
  const compiled = compile(source, { partials });
  const cOut = compiled.render(data);

  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) compiled.render(data);
  const compiledMs = performance.now() - t0;

  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) renderNaive(source, data, { partials });
  const naiveMs = performance.now() - t1;

  const nOut = renderNaive(source, data, { partials });
  return {
    compiledMs, naiveMs,
    speedup: naiveMs / Math.max(compiledMs, 0.001),
    equal: cOut === nOut,
    output: cOut,
    iterations,
  };
}
