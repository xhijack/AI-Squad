// SPDX-License-Identifier: Apache-2.0
// Audit dialog (dock): run an audit of the Floor (since the last audit or one sprint), the scores per area, findings
// sorted by severity with evidence links into the Squad Log, and the history of audits so trends show.
import { esc, money, api, openModal, toast } from './lib.js';
import { ctx } from './ctx.js';
import { t as tt, tx } from './i18n.js';

const SEV = { critical: 'bad', high: 'bad', medium: 'warn', low: 'info' };
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const usd = (v, d = 2) => (v == null ? '–' : `$${(+v).toFixed(d)}`);
const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

let S = null;            // { floorId, list, current, running, sprint, model, poll }

function scoreHtml(s) {
  const bar = (label, v) => `<div><span>${label}</span><b>${v}</b><i class="sbar ${v < 60 ? 'bad' : v < 85 ? 'warn' : ''}" role="img" aria-label="${tt('{v} of 100', { v })}"><i style="width:${v}%"></i></i></div>`;
  return `<div class="kpis">${bar(tt('Process'), s.process)}${bar(tt('Efficiency'), s.efficiency)}${bar(tt('Quality'), s.quality)}${bar(tt('Overall'), s.overall)}</div>`;
}

// evidence: E12 links into the Log timeline; metric names stay text
function evidenceHtml(a, list) {
  return list.map((x) => {
    const ref = (x.match(/^E\d+$/) || [])[0];
    return ref && a.refs?.[ref] ? `<button type="button" class="chip info evLink" data-ev="${esc(a.refs[ref])}" title="${tt('Open in the Squad Log')}">${esc(ref)}</button>` : `<span class="chip">${esc(x.replace(/^metric:/, ''))}</span>`;
  }).join(' ');
}

export function targetHtml(f) {
  const t = f.target;
  if (!t) return '';
  const c = t.proposedChange;
  const lines = [...c.addRules.map((r) => `+ rule: ${r}`), ...c.removeRules.map((r) => `- rule: ${r}`), ...(c.appendPrompt ? [`+ prompt: ${c.appendPrompt}`] : []),
    ...(c.model ? [`model: ${c.model}`] : []), ...(c.effort ? [`effort: ${c.effort}`] : []), ...(c.setting ? [`${c.setting} = ${c.value}`] : [])];
  return `<div class="auditTarget"><div class="note">${tt('Proposed change to {kind} <code>{id}</code>', { kind: esc(t.kind), id: esc(t.id) })}${c.summary ? `: ${esc(c.summary)}` : ''}</div>
    <div class="mono small">${lines.map(esc).join('<br>')}</div>${ctx.auditTargetActions ? ctx.auditTargetActions(S, f) : ''}</div>`;
}

function findingHtml(a, f) {
  return `<div class="card finding"><div class="row wrap"><span class="chip ${SEV[f.severity]}">${esc(tx(f.severity))}</span><span class="chip">${esc(tx(f.area))}</span><b class="grow">${esc(f.id)} · ${esc(f.title)}</b></div>
    <p>${esc(f.recommendation)}</p><div class="row wrap evidence"><span class="note">${tt('Evidence')}</span> ${evidenceHtml(a, f.evidence)}</div>${targetHtml(f)}</div>`;
}

function historyHtml() {
  if (!S.list.length) return `<div class="empty">${tt('No audits yet.')}</div>`;
  const spark = (key, fmt) => {
    const vals = [...S.list].reverse().map((h) => h.trend?.[key]).filter((v) => v != null);
    if (vals.length < 2) return '';
    const max = Math.max(...vals) || 1, w = 90, h = 22;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - v / max * (h - 2) - 1).toFixed(1)}`).join(' ');
    return `<div class="trend"><span>${esc(fmt)}</span><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}"/></svg></div>`;
  };
  return `<div class="row wrap trends">${spark('costPerSP', tt('Cost / SP'))}${spark('passRate', tt('First-round pass'))}${spark('cacheHitRate', tt('Cache hit rate'))}</div>
    <div class="tableWrap"><table class="perf"><thead><tr><th>${tt('When')}</th><th>${tt('Range')}</th><th>${tt('Score')}</th><th>${tt('Findings')}</th><th>${tt('Cost / SP')}</th><th>${tt('Pass')}</th><th>${tt('Cache')}</th><th>${tt('Audit cost')}</th></tr></thead><tbody>
    ${S.list.map((h) => `<tr class="pick${S.current?.id === h.id ? ' sel' : ''}" data-audit="${esc(h.id)}" tabindex="0"><td>${when(h.createdAt)}</td><td>${esc(tx(h.label || ''))}</td><td>${h.error && !h.findings ? `<span class="chip warn">${tt('error')}</span>` : h.scores.overall}</td>
      <td>${h.findings}</td><td>${usd(h.trend?.costPerSP, 3)}</td><td>${pct(h.trend?.passRate)}</td><td>${pct(h.trend?.cacheHitRate)}</td><td>${usd(h.cost, 4)}</td></tr>`).join('')}</tbody></table></div>`;
}

function auditHtml(a) {
  if (!a) return '';
  const E = a.metrics.efficiency, P = a.metrics.process;
  return `<h4 class="perfH" style="margin-bottom:2px">${tt('Audit · {range} · {when}', { range: esc(tx(a.range.label)), when: when(a.createdAt) })}</h4>
    <div class="note">${tt('{n} events · reviewed by {model} for {cost}', { n: a.range.events, model: esc(a.model), cost: usd(a.cost, 4) })}</div>
    ${a.error ? `<p class="chip warn" style="white-space:normal">${esc(tx(a.error))}</p>` : ''}
    ${scoreHtml(a.scores)}
    <div class="kpis"><div><span>${tt('Cost')}</span><b>${usd(E.totals.cost)}</b></div><div><span>${tt('Cost / SP')}</span><b>${usd(E.costPerSP, 3)}</b></div><div><span>${tt('First-round pass')}</span><b>${pct(P.qaFirstRoundPassRate)}</b></div>
      <div><span>${tt('Cache hit rate')}</span><b>${pct(E.cacheHitRate)}</b></div><div><span>${tt('Bugs')}</span><b>${P.bugs.total}</b></div><div><span>${tt('Waiting on you')}</span><b>${tt('{n} min', { n: E.blockedOnOwnerMin })}</b></div></div>
    ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
    ${a.retro ? `<div class="row" style="margin:8px 0"><span class="chip ok">${tt('Retro of sprint {n}', { n: esc(a.retro.sprint) })}</span><button class="small" data-retro>${tt('Open the Retro')}</button></div>` : ''}
    <h4 class="perfH">${tt('Findings')}</h4>${a.findings.length ? a.findings.map((f) => findingHtml(a, f)).join('') : `<div class="empty">${tt('No findings.')}</div>`}`;
}

function draw() {
  const body = openModal(`<div class="mHead"><h3 class="grow">${tt('Audit · {name}', { name: esc(ctx.state.floor?.name || S.floorId) })}</h3><button class="ghost iconBtn" data-close aria-label="${tt('Close')}">×</button></div>
    <div class="mBody">
      <div class="card"><div class="row wrap auditRun">
        <label>${tt('Range')} <select data-f="sprint"><option value="">${tt('Since the last audit')}</option>${S.sprints.map((n) => `<option value="${n}" ${String(S.sprint) === String(n) ? 'selected' : ''}>${tt('Sprint {n}', { n })}</option>`).join('')}</select></label>
        <label>${tt('Model')} <select data-f="model">${S.models.map((m) => `<option ${m === S.model ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <span class="grow"></span>
        ${S.running ? `<span class="note">${S.running.sprint != null ? tt('Auditing sprint {n} since {when}…', { n: S.running.sprint, when: when(new Date(S.running.since).toISOString()) }) : tt('Auditing since {when}…', { when: when(new Date(S.running.since).toISOString()) })}</span>` : `<button class="gold" data-run>${tt('Run audit')}</button>`}
      </div><p class="note" style="margin-bottom:0">${tt('The digest of the Squad Log (metrics and the most relevant events, not the raw log) goes to <code>claude -p</code> with the squad-audit skill.')} ${S.settings.auto ? tt('Runs automatically after a sprint closes.') : tt('Automatic audits are off for this Floor.')}</p></div>
      ${auditHtml(S.current)}
      <h4 class="perfH">${tt('History')}</h4>${historyHtml()}
      ${ctx.auditLedgerHtml ? ctx.auditLedgerHtml(S) : ''}
    </div>`);
  const dlg = body.closest('dialog');
  dlg.classList.add('wide');
  body.querySelector('[data-close]').onclick = () => dlg.close();
  body.querySelectorAll('[data-f]').forEach((sel) => sel.onchange = () => { S[sel.dataset.f] = sel.value; });
  body.querySelector('[data-run]')?.addEventListener('click', run);
  body.querySelector('[data-retro]')?.addEventListener('click', () => ctx.actions.retro());
  body.querySelectorAll('[data-audit]').forEach((tr) => { const open = () => show(tr.dataset.audit); tr.onclick = open; tr.onkeydown = (e) => { if (e.key === 'Enter') open(); }; });
  body.querySelectorAll('.evLink').forEach((b) => b.onclick = () => ctx.actions.log({ focus: b.dataset.ev, back: true }));
  ctx.bindAuditTargets?.(body, S, draw);
}

async function show(id) { S.current = await api('GET', `/api/floors/${S.floorId}/audits/${id}`); draw(); }

async function refresh() {
  const r = await api('GET', `/api/floors/${S.floorId}/audits`);
  const wasRunning = !!S.running;
  Object.assign(S, { list: r.audits, running: r.running, sprints: r.sprints, settings: r.settings, models: r.models, ledger: r.ledger || [] });
  S.model ||= r.settings.model;
  if (wasRunning && !r.running && r.audits[0]) { toast(tt('Audit finished')); S.current = await api('GET', `/api/floors/${S.floorId}/audits/${r.audits[0].id}`); }
  if (!S.current && r.audits[0]) S.current = await api('GET', `/api/floors/${S.floorId}/audits/${r.audits[0].id}`);
  return wasRunning !== !!r.running;
}

async function run() {
  await api('POST', `/api/floors/${S.floorId}/audits`, { sprint: S.sprint === '' ? null : Number(S.sprint), model: S.model });
  S.running = { since: Date.now(), sprint: S.sprint || null };
  draw();
  watch();
}
function watch() {
  clearInterval(S.poll);
  S.poll = setInterval(async () => { if (!document.getElementById('modal').open) return clearInterval(S.poll); if (await refresh().catch(() => false)) draw(); if (!S.running) clearInterval(S.poll); }, 3000);
}

ctx.actions.audit = async () => {
  S = { floorId: ctx.state.route.floorId, list: [], current: null, running: null, sprints: [], settings: {}, models: [], ledger: [], sprint: '', model: '', poll: null };
  // after a decision: the history, the ledger and the shown audit (with its decisions) again
  S.reload = async () => { await refresh(); if (S.current) S.current = await api('GET', `/api/floors/${S.floorId}/audits/${S.current.id}`); draw(); };
  await refresh();
  draw();
  if (S.running) watch();
};
// the Log dialog replaces this one; coming back reopens the Audit where it was
ctx.reopenAudit = () => { if (S) draw(); };
