// Improvement loop in the Audit dialog: a finding with a target shows its proposed change as a diff; Apply saves a new
// Role Template or Blueprint version (Floors then see "Update available") or changes the Floor setting; Dismiss asks
// why. The ledger lists every decision with the metrics before and after (from the next audit).
import { esc, api, toast, diffHtml } from './lib.js';
import { ctx } from './ctx.js';
import { t, tx } from './i18n.js';

const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const usd = (v) => (v == null ? '–' : `$${(+v).toFixed(3)}`);
const when = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
const decisionText = (d) => (d.decision === 'applied' ? (d.version ? t('Applied as v{v}', { v: d.version }) : t('Applied')) : t('Dismissed: {reason}', { reason: d.reason }));

ctx.auditTargetActions = (S, f) => {
  const d = S.current?.decisions?.[f.id];
  if (d) return `<div class="row" style="margin-top:8px"><span class="chip ${d.decision === 'applied' ? 'ok' : ''}">${esc(decisionText(d))}</span></div>`;
  return `<div class="row wrap" style="margin-top:8px"><button type="button" class="small" data-propose="${esc(f.id)}">${t('Review change')}</button><button type="button" class="small ghost" data-dismiss="${esc(f.id)}">${t('Dismiss')}</button></div><div data-prop="${esc(f.id)}"></div>`;
};

ctx.bindAuditTargets = (body, S) => {
  const base = () => `/api/floors/${S.floorId}/audits/${S.current.id}/findings`;
  body.querySelectorAll('[data-propose]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.propose, box = body.querySelector(`[data-prop="${id}"]`);
    box.innerHTML = `<p class="note">${t('Loading the proposed change…')}</p>`;
    try {
      const p = await api('GET', `${base()}/${id}/proposal`);
      const what = p.kind === 'role-template' ? t('Role Template <code>{id}</code> v{from} → v{to}. Floors using it show <b>Update available</b>.', { id: esc(p.id), from: p.fromVersion, to: p.toVersion })
        : p.kind === 'blueprint' ? t('Blueprint <code>{id}</code> v{from} → v{to}, in "Lessons from audits". Floors following it can update in the Standard tab.', { id: esc(p.id), from: p.fromVersion, to: p.toVersion })
          : t('Floor setting <code>{setting}</code> on this Floor.', { setting: esc(p.setting || '') });
      box.innerHTML = `<div class="proposal"><p class="note">${what}</p>${diffHtml(p.diff.filter((l, i, a) => l.op !== ' ' || a.slice(Math.max(0, i - 2), i + 3).some((x) => x.op !== ' ')))}
        ${p.applicable ? `<div class="row" style="margin-top:8px"><span class="grow"></span><button type="button" class="gold small" data-apply="${esc(id)}">${t('Apply')}</button></div>` : `<p class="chip warn" style="white-space:normal">${esc(tx(p.reason))}</p>`}</div>`;
      box.querySelector('[data-apply]')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        try { const r = await api('POST', `${base()}/${id}/apply`); toast(r.decision.versionCreated ? t('Saved as version {n}', { n: r.decision.versionCreated }) : t('Applied')); await S.reload(); }
        catch (err) { toast(err.message); e.target.disabled = false; }
      });
    } catch (e) { box.innerHTML = `<p class="chip warn">${esc(e.message)}</p>`; }
  });
  body.querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => {
    const id = b.dataset.dismiss, box = body.querySelector(`[data-prop="${id}"]`);
    box.innerHTML = `<div class="proposal"><label>${t('Why do you dismiss it? (kept in the improvement ledger)')}</label><input data-reason maxlength="500" placeholder="${t('e.g. the wait was a holiday, not a process problem')}">
      <div class="row" style="margin-top:8px"><span class="grow"></span><button type="button" class="small" data-confirm>${t('Dismiss')}</button></div></div>`;
    const input = box.querySelector('[data-reason]');
    input.focus();
    box.querySelector('[data-confirm]').onclick = async () => {
      try { await api('POST', `${base()}/${id}/dismiss`, { reason: input.value }); toast(t('Dismissed')); await S.reload(); } catch (e) { toast(e.message); }
    };
  });
};

ctx.auditLedgerHtml = (S) => {
  if (!S.ledger?.length) return '';
  return `<h4 class="perfH">${t('Improvements')}</h4><div class="tableWrap"><table class="perf"><thead><tr><th>${t('When')}</th><th>${t('Finding')}</th><th>${t('Target')}</th><th>${t('Decision')}</th><th>${t('Cost / SP')}</th><th>${t('First-round pass')}</th></tr></thead><tbody>
    ${S.ledger.map((d) => { const a = d.outcome?.metricAfter; return `<tr><td>${when(d.ts)}</td><td>${esc(d.finding.title)}</td><td>${d.target ? `${esc(d.target.kind)} <code>${esc(d.target.id)}</code>` : '–'}</td>
      <td>${esc(decisionText({ ...d, version: d.versionCreated }))}</td><td>${usd(d.metricBefore?.costPerSP)} → ${a ? usd(a.costPerSP) : '…'}</td><td>${pct(d.metricBefore?.passRate)} → ${a ? pct(a.passRate) : '…'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="note">${t('"After" comes from the next audit of this Floor. <code>/aisquad audit export</code> writes an anonymised bundle you may send to Sopwer; nothing is uploaded automatically.')}</p>`;
};
