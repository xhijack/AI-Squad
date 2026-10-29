// SPDX-License-Identifier: Apache-2.0
// Menu → Backups and health: what `aisquad doctor` checks, the backups (back up now, check one), the nightly
// backup schedule, and how many agents may run at once on this machine.
import { esc, api, toast, openModal, closeModal, gb } from './lib.js';
import { ctx } from './ctx.js';
import { t } from './i18n.js';

const MARK = { ok: '✓', warn: '!', fail: '×' };
const size = (n) => (n > 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

function checksHtml(d) {
  return `<ul class="checks">${d.checks.map((c) => `<li class="${c.status}"><b class="mark" aria-label="${esc(c.status)}">${MARK[c.status]}</b><span class="grow"><b>${esc(c.title)}</b> <span class="note">${esc(c.detail)}</span>${c.fix ? `<br><span class="note">→ ${esc(c.fix)}</span>` : ''}</span></li>`).join('')}</ul>`;
}
function backupsHtml(b) {
  const st = b.status || {};
  const last = st.lastBackup ? (st.lastBackup.ok ? t('Last nightly backup: {when}', { when: when(st.lastBackup.at) }) : t('The last nightly backup failed: {error}', { error: esc(st.lastBackup.error) })) : t('No nightly backup yet.');
  const verify = st.lastVerify ? (st.lastVerify.ok ? t('Last check: {when}, it reads back.', { when: when(st.lastVerify.at) }) : t('Last check failed: {error}', { error: esc(st.lastVerify.errors?.[0] || '') })) : '';
  return `<p class="note">${last} ${verify}</p>
    ${b.backups.length ? `<ul class="list">${b.backups.slice(0, 8).map((x) => `<li class="row"><span class="grow mono ellipsis" title="${esc(x.file)}">${esc(x.name)}</span><span class="note">${size(x.size)}${x.encrypted ? ` · ${t('encrypted')}` : ''}</span><button class="small ghost" data-verify="${esc(x.name)}">${t('Check')}</button></li>`).join('')}</ul>` : `<div class="empty">${t('No backups in {dir} yet.', { dir: esc(b.settings.dir || b.defaultDir) })}</div>`}`;
}

async function healthDialog() {
  const [d, b] = await Promise.all([api('GET', '/api/doctor'), api('GET', '/api/backups')]);
  const lim = ctx.state.building?.limits || {};
  const s = b.settings;
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Backups and health')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody">
      <h3>${t('This machine')}</h3>${checksHtml(d)}
      <h3 style="margin-top:var(--sp-5)">${t('Agents at once')}</h3>
      <div class="grid2"><div><label for="hMax">${t('At most this many agents run at the same time on this machine')}</label><input id="hMax" type="number" min="1" max="40" value="${lim.maxAgents || 6}"></div>
        <p class="note">${lim.session?.measured ? t('One agent session uses about {ram} here (measured; peak {peak}).', { ram: gb(lim.session.avgRss), peak: gb(lim.session.peakRss) }) : t('Until sessions are measured, one agent session counts as 1 GB.')} ${t('Each Floor keeps its own maximum too (Floor settings).')}</p></div>
      <h3 style="margin-top:var(--sp-5)">${t('Backups')}</h3>
      <p class="note">${t('A backup holds the Building (Floors, teams, Role Templates, Squad Log, settings), each Floor\'s configuration and Claude Code\'s memory per Floor. Repositories come back from their git remotes. Restore on another machine with <code>/aisquad restore &lt;file&gt;</code>.')}</p>
      <div id="hList">${backupsHtml(b)}</div>
      <label class="inline"><input type="checkbox" id="hOn" ${s.enabled ? 'checked' : ''}> ${t('Back up every night')}</label>
      <div class="grid2"><div><label for="hTime">${t('At (local time)')}</label><input id="hTime" type="time" value="${esc(s.time)}"></div><div><label for="hKeep">${t('Keep the newest')}</label><input id="hKeep" type="number" min="1" max="90" value="${s.keep}"></div></div>
      <label for="hDir">${t('Folder (empty: {dir}); a synced folder or a USB disk keeps it off this machine', { dir: esc(b.defaultDir) })}</label><input id="hDir" value="${esc(s.dir)}" placeholder="${esc(b.defaultDir)}">
      <label class="inline"><input type="checkbox" id="hLogs" ${s.logs ? 'checked' : ''}> ${t('Include the Squad Log')}</label>
      <label for="hPass">${b.encrypted ? t('Backups are encrypted. New passphrase (empty: keep it)') : t('Passphrase to encrypt backups (at least 8 characters; empty: not encrypted, without secrets)')}</label><input id="hPass" type="password" autocomplete="new-password">
      ${b.encrypted ? `<label class="inline"><input type="checkbox" id="hPlain"> ${t('Stop encrypting backups')}</label>` : ''}
      <p class="note">${t('Keep the passphrase somewhere safe: without it an encrypted backup cannot be opened.')}</p>
    </div>
    <div class="mFoot"><div class="err grow" id="hErr"></div><button class="ghost" data-now>${t('Back up now')}</button><button class="gold" data-save>${t('Save')}</button></div>`);
  const q = (id) => body.querySelector(`#${id}`);
  body.querySelectorAll('[data-close]').forEach((x) => x.onclick = () => closeModal());
  const reloadList = async () => { const nb = await api('GET', '/api/backups'); q('hList').innerHTML = backupsHtml(nb); };
  body.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-verify]');
    if (!v) return;
    v.disabled = true;
    try { const r = await api('POST', '/api/backups/verify', { name: v.dataset.verify }); toast(r.ok ? t('It reads back: {n} files', { n: r.files }) : t('It does not read back: {error}', { error: r.errors[0] }), 5000); } catch (err) { toast(err.message); }
    v.disabled = false;
  });
  body.querySelector('[data-now]').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api('POST', '/api/backups'); toast(t('Backup written ({size})', { size: size(r.size) })); await reloadList(); } catch (err) { q('hErr').textContent = err.message; }
    e.target.disabled = false;
  };
  body.querySelector('[data-save]').onclick = async () => {
    const patch = { maxAgents: +q('hMax').value, backup: { enabled: q('hOn').checked, time: q('hTime').value, keep: +q('hKeep').value, dir: q('hDir').value.trim(), logs: q('hLogs').checked } };
    if (q('hPass').value) patch.backupPassphrase = q('hPass').value;
    else if (q('hPlain')?.checked) patch.backupPassphrase = '';
    try { await api('PATCH', '/api/building', patch); closeModal(); toast(t('Saved')); ctx.refresh(); } catch (err) { q('hErr').textContent = err.message; }
  };
}
ctx.actions.health = () => healthDialog();
