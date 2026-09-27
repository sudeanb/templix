// Templix playground — live compile + render + generated-code view.

import { compile } from '../src/index.js';

const DEFAULT_TPL = `<h1>Order {{ order }} for {{ user.name }}</h1>
{% if admin %}<p class="admin">staff order</p>{% endif %}

<ul>
{% each items as item %}
  <li>{{ item.name }} × {{ item.qty }} = {{ item.qty * item.price }}</li>
{% endeach %}
</ul>

<!-- raw output is opt-in and flagged by analyze() -->
{{{ trustedHtml }}}
`;

const DEFAULT_DATA = JSON.stringify({
  order: 42,
  user: { name: 'Ada' },
  admin: true,
  trustedHtml: '<em>trusted</em>',
  items: [
    { name: 'Keyboard', qty: 1, price: 50 },
    { name: 'Mouse', qty: 2, price: 25 },
  ],
}, null, 2);

const tplEl = document.getElementById('tpl');
const dataEl = document.getElementById('data');
const msgEl = document.getElementById('msg');
const previewEl = document.getElementById('preview');
const codeEl = document.getElementById('code');
const analyzeEl = document.getElementById('analyze');

let partials = {};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderAll() {
  msgEl.className = 'msg';
  msgEl.textContent = '';
  let data;
  try {
    data = JSON.parse(dataEl.value);
  } catch (err) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'data JSON: ' + err.message;
    return;
  }
  try {
    const t = compile(tplEl.value, { partials, name: 'page' });
    previewEl.innerHTML = t.render(data);
    codeEl.textContent = t.code;
    const a = t.analyze();
    analyzeEl.textContent = `${t.stats.output} outputs (${a.autoEscaped} escaped, ${a.rawOutputs} raw) · ${t.stats.each} loops · ${t.stats.if} ifs — ${a.advice}`;
    analyzeEl.className = 'msg ' + (a.xssRisk ? 'err' : 'ok');
  } catch (err) {
    msgEl.className = 'msg err';
    msgEl.textContent = err.message;
  }
}

document.getElementById('render').addEventListener('click', renderAll);
tplEl.addEventListener('input', renderAll);
dataEl.addEventListener('input', renderAll);

document.getElementById('bench').addEventListener('click', async () => {
  const { bench } = await import('../src/index.js');
  let data;
  try { data = JSON.parse(dataEl.value); } catch (err) { msgEl.className = 'msg err'; msgEl.textContent = err.message; return; }
  const r = bench(tplEl.value, data, { iterations: 3000, partials });
  benchEl.innerHTML =
    `<div class="bar-row"><span class="lbl">compiled</span><span class="bar" style="width:${(r.compiledMs / r.naiveMs) * 100}%"></span> ${r.compiledMs.toFixed(1)}ms</div>` +
    `<div class="bar-row n"><span class="lbl">naive walk</span><span class="bar" style="width:100%"></span> ${r.naiveMs.toFixed(1)}ms</div>` +
    `<div>speedup ${r.speedup.toFixed(1)}× · outputs ${r.equal ? 'identical ✓' : 'DIFFER ✗'} · ${r.iterations} iterations</div>`;
});

tplEl.value = DEFAULT_TPL;
dataEl.value = DEFAULT_DATA;
renderAll();
