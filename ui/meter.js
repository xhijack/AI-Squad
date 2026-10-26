// SPDX-License-Identifier: Apache-2.0
// Server meter: the dock chip (CPU / RAM / swap / disk, red when dangerous) and the dialog with a
// 6 minute graph, process groups and the busiest processes. Data from GET /api/meter (sampled every 3 s).
import { esc, gb, api, openModal } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt } from './i18n.js';

const pct = (u, t) => (t ? Math.round(u / t * 100) : 0);

export function meterChip(m) {
  if (!m) return '';
  const L = m.levels || {};
  const seg = (k, text) => `<span class="m ${L[k] || 'ok'}">${text}</span>`;
  return `<button class="small meterChip ${L.overall || 'ok'}" data-act="meter" title="${tt('Server meter: CPU, RAM, swap and disk of this machine')}">
    ${seg('cpu', tt('CPU {n} %', { n: Math.round(m.cpu) }))}${seg('ram', tt('RAM {n} %', { n: pct(m.mem.used, m.mem.total) }))}<span class="hideSm">${m.swap.total ? seg('swap', tt('Swap {n} %', { n: pct(m.swap.used, m.swap.total) })) : ''}${m.disk ? seg('disk', tt('Disk {free} free', { free: gb(m.disk.free) })) : ''}</span></button>`;
}

function graph(hist) {
  const W = 640, H = 160, n = 120;
  const pts = (key) => hist.map((h, i) => `${(W * (i + n - hist.length) / (n - 1)).toFixed(1)},${(H - h[key] / 100 * H).toFixed(1)}`).join(' ');
  return `<svg class="meterGraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${tt('CPU and RAM over the last 6 minutes')}">
    ${[25, 50, 75].map((y) => `<line x1="0" x2="${W}" y1="${H - y / 100 * H}" y2="${H - y / 100 * H}" class="grid"/>`).join('')}
    <polyline points="${pts('mem')}" class="mem"/><polyline points="${pts('swap')}" class="swap"/><polyline points="${pts('cpu')}" class="cpu"/></svg>
    <div class="row note" style="justify-content:space-between"><span>${tt('6 min ago')}</span><span><i class="key cpu"></i> CPU <i class="key mem"></i> RAM <i class="key swap"></i> ${tt('Swap')}</span><span>${tt('now')}</span></div>`;
}

function bar(label, used, total, level, text) {
  return `<div class="meterBar ${level}"><div class="row"><b class="grow">${label}</b><span class="note">${text}</span></div><div class="track"><i style="width:${Math.min(100, pct(used, total))}%"></i></div></div>`;
}

let timer = null;
async function draw(first) {
  const d = await api('GET', '/api/meter');
  const s = d.last;
  const html = !s ? `<div class="empty">${tt('No samples yet (the meter needs /proc, so it works on Linux).')}</div>` : `
    <div class="grid2">${bar('CPU', s.cpu, 100, s.levels.cpu, tt('{pct} % of {n} cores · load {load}', { pct: s.cpu, n: s.ncpu, load: s.load[0] }))}${bar('RAM', s.mem.used, s.mem.total, s.levels.ram, tt('{free} free of {total}', { free: gb(s.mem.total - s.mem.used), total: gb(s.mem.total) }))}
      ${bar(tt('Swap'), s.swap.used, s.swap.total, s.levels.swap, s.swap.total ? tt('{used} of {total}', { used: gb(s.swap.used), total: gb(s.swap.total) }) : tt('none'))}${s.disk ? bar(tt('Disk'), s.disk.total - s.disk.free, s.disk.total, s.levels.disk, tt('{free} free of {total}', { free: gb(s.disk.free), total: gb(s.disk.total) })) : ''}</div>
    <h4 class="perfH">${tt('Last 6 minutes')}</h4>${graph(d.hist)}
    <h4 class="perfH">${tt('Process groups')}</h4>
    <div class="tableWrap"><table class="perf"><thead><tr><th>${tt('Group')}</th><th>${tt('Processes')}</th><th>CPU</th><th>RAM</th></tr></thead><tbody>
      ${s.groups.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.n}</td><td>${g.cpu} %</td><td>${gb(g.rss)}</td></tr>`).join('') || `<tr><td colspan="4" class="note">${tt('Nothing busy.')}</td></tr>`}</tbody></table></div>
    <h4 class="perfH">${tt('Busiest processes')}</h4>
    <div class="tableWrap"><table class="perf"><thead><tr><th>${tt('Process')}</th><th>PID</th><th>${tt('Group')}</th><th>CPU</th><th>RAM</th></tr></thead><tbody>
      ${s.top.map((p) => `<tr><td>${esc(p.comm)}</td><td>${p.pid}</td><td>${esc(p.group)}</td><td>${p.cpu} %</td><td>${gb(p.rss)}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">${tt('CPU is the share of the whole machine. Red means dangerous: free RAM below 1.5 GB, swap above 85 %, disk below 5 GB, CPU above 92 %.')}</p>`;
  if (first) {
    const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Server meter')}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div><div class="mBody" id="meterBody">${html}</div>`, { onClose: () => { clearInterval(timer); timer = null; } });
    body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  } else {
    const el = document.getElementById('meterBody');
    if (el) el.innerHTML = html;
  }
}

ctx.actions.meter = async () => {
  await draw(true);
  clearInterval(timer);
  timer = setInterval(() => draw(false).catch(() => {}), 3000);
};
