// Audit dialog (dock): run an audit of the Floor (since the last audit or one sprint), the scores per area, findings
// sorted by severity with evidence links into the Squad Log, and the history of audits so trends show.
import { esc, money, api, openModal, toast } from './lib.js';
import { ctx } from './ctx.js';

const SEV = { critical: 'bad', high: 'bad', medium: 'warn', low: 'info' };
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const usd = (v, d = 2) => (v == null ? '–' : `$${(+v).toFixed(d)}`);
const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

let S = null;            // { floorId, list, current, running, sprint, model, poll }

function scoreHtml(s) {
  const bar = (label, v) => `<div><span>${label}</span><b>${v}</b><i class="sbar ${v < 60 ? 'bad' : v < 85 ? 'warn' : ''}" role="img" aria-label="${v} of 100"><i style="width:${v}%"></i></i></div>`;
  return `<div class="kpis">${bar('Process', s.process)}${bar('Efficiency', s.efficiency)}${bar('Quality', s.quality)}${bar('Overall', s.overall)}</div>`;
}

// evidence: E12 links into the Log timeline; metric names stay text
function evidenceHtml(a, list) {
  return list.map((x) => {
    const ref = (x.match(/^E\d+$/) || [])[0];
    return ref && a.refs?.[ref] ? `<button type="button" class="chip info evLink" data-ev="${esc(a.refs[ref])}" title="Open in the Squad Log">${esc(ref)}</button>` : `<span class="chip">${esc(x.replace(/^metric:/, ''))}</span>`;
  }).join(' ');
}

export function targetHtml(f) {
  const t = f.target;
  if (!t) return '';
  const c = t.proposedChange;
  const lines = [...c.addRules.map((r) => `+ rule: ${r}`), ...c.removeRules.map((r) => `- rule: ${r}`), ...(c.appendPrompt ? [`+ prompt: ${c.appendPrompt}`] : []),
    ...(c.model ? [`model: ${c.model}`] : []), ...(c.effort ? [`effort: ${c.effort}`] : []), ...(c.setting ? [`${c.setting} = ${c.value}`] : [])];
  return `<div class="auditTarget"><div class="note">Proposed change to ${esc(t.kind)} <code>${esc(t.id)}</code>${c.summary ? `: ${esc(c.summary)}` : ''}</div>
    <div class="mono small">${lines.map(esc).join('<br>')}</div>${ctx.auditTargetActions ? ctx.auditTargetActions(S, f) : ''}</div>`;
}

function findingHtml(a, f) {
  return `<div class="card finding"><div class="row wrap"><span class="chip ${SEV[f.severity]}">${esc(f.severity)}</span><span class="chip">${esc(f.area)}</span><b class="grow">${esc(f.id)} · ${esc(f.title)}</b></div>
    <p>${esc(f.recommendation)}</p><div class="row wrap evidence"><span class="note">Evidence</span> ${evidenceHtml(a, f.evidence)}</div>${targetHtml(f)}</div>`;
}

function historyHtml() {
  if (!S.list.length) return '<div class="empty">No audits yet.</div>';
  const spark = (key, fmt) => {
    const vals = [...S.list].reverse().map((h) => h.trend?.[key]).filter((v) => v != null);
    if (vals.length < 2) return '';
    const max = Math.max(...vals) || 1, w = 90, h = 22;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - v / max * (h - 2) - 1).toFixed(1)}`).join(' ');
    return `<div class="trend"><span>${esc(fmt)}</span><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}"/></svg></div>`;
  };
  return `<div class="row wrap trends">${spark('costPerSP', 'Cost / SP')}${spark('passRate', 'First-round pass')}${spark('cacheHitRate', 'Cache hit rate')}</div>
    <div class="tableWrap"><table class="perf"><thead><tr><th>When</th><th>Range</th><th>Score</th><th>Findings</th><th>Cost / SP</th><th>Pass</th><th>Cache</th><th>Audit cost</th></tr></thead><tbody>
    ${S.list.map((h) => `<tr class="pick${S.current?.id === h.id ? ' sel' : ''}" data-audit="${esc(h.id)}" tabindex="0"><td>${when(h.createdAt)}</td><td>${esc(h.label || '')}</td><td>${h.error && !h.findings ? '<span class="chip warn">error</span>' : h.scores.overall}</td>
      <td>${h.findings}</td><td>${usd(h.trend?.costPerSP, 3)}</td><td>${pct(h.trend?.passRate)}</td><td>${pct(h.trend?.cacheHitRate)}</td><td>${usd(h.cost, 4)}</td></tr>`).join('')}</tbody></table></div>`;
}

function auditHtml(a) {
  if (!a) return '';
  const E = a.metrics.efficiency, P = a.metrics.process;
  return `<h4 class="perfH" style="margin-bottom:2px">Audit · ${esc(a.range.label)} · ${when(a.createdAt)}</h4>
    <div class="note">${a.range.events} events · reviewed by ${esc(a.model)} for ${usd(a.cost, 4)}</div>
    ${a.error ? `<p class="chip warn" style="white-space:normal">${esc(a.error)}</p>` : ''}
    ${scoreHtml(a.scores)}
    <div class="kpis"><div><span>Cost</span><b>${usd(E.totals.cost)}</b></div><div><span>Cost / SP</span><b>${usd(E.costPerSP, 3)}</b></div><div><span>First-round pass</span><b>${pct(P.qaFirstRoundPassRate)}</b></div>
      <div><span>Cache hit rate</span><b>${pct(E.cacheHitRate)}</b></div><div><span>Bugs</span><b>${P.bugs.total}</b></div><div><span>Waiting on you</span><b>${E.blockedOnOwnerMin} min</b></div></div>
    ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
    ${a.retro ? `<div class="row" style="margin:8px 0"><span class="chip ok">Retro of sprint ${esc(a.retro.sprint)}</span><button class="small" data-retro>Open the Retro</button></div>` : ''}
    <h4 class="perfH">Findings</h4>${a.findings.length ? a.findings.map((f) => findingHtml(a, f)).join('') : '<div class="empty">No findings.</div>'}`;
}

function draw() {
  const body = openModal(`<div class="mHead"><h3 class="grow">Audit · ${esc(ctx.state.floor?.name || S.floorId)}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody">
      <div class="card"><div class="row wrap auditRun">
        <label>Range <select data-f="sprint"><option value="">Since the last audit</option>${S.sprints.map((n) => `<option value="${n}" ${String(S.sprint) === String(n) ? 'selected' : ''}>Sprint ${n}</option>`).join('')}</select></label>
        <label>Model <select data-f="model">${S.models.map((m) => `<option ${m === S.model ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <span class="grow"></span>
        ${S.running ? `<span class="note">Auditing${S.running.sprint != null ? ` sprint ${S.running.sprint}` : ''} since ${when(new Date(S.running.since).toISOString())}…</span>` : '<button class="gold" data-run>Run audit</button>'}
      </div><p class="note" style="margin-bottom:0">The digest of the Squad Log (metrics and the most relevant events, not the raw log) goes to <code>claude -p</code> with the squad-audit skill. ${S.settings.auto ? 'Runs automatically after a sprint closes.' : 'Automatic audits are off for this Floor.'}</p></div>
      ${auditHtml(S.current)}
      <h4 class="perfH">History</h4>${historyHtml()}
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
  if (wasRunning && !r.running && r.audits[0]) { toast('Audit finished'); S.current = await api('GET', `/api/floors/${S.floorId}/audits/${r.audits[0].id}`); }
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
