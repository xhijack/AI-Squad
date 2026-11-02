// SPDX-License-Identifier: Apache-2.0
// The update card on the admin page (1.10): the version now, a newer one with its release lines, Update (fast-forward
// and restart, the page reloads itself when the server is back), Check now, and why Update cannot run here.
import { esc, api, toast } from './lib.js';
import { t, tx } from './i18n.js';

const REASON = { plugin: t('Installed as a Claude Code plugin: update it in Claude Code.'), 'not a git checkout': t('This copy is not a git checkout: install with install.sh to update from here.'), 'detached HEAD': t('The app folder is not on a branch.'),
  'this checkout has its own commits': t('The app folder has its own commits: update it by hand.'), 'this checkout has local changes': t('The app folder has local changes: update it by hand.'), 'check failed': t('The check failed.') };

export function updateHtml(u) {
  const head = `<div class="sectionHead"><h3 class="grow">${t('Update')}</h3><button class="small ghost" data-ucheck>${t('Check now')}</button></div>`;
  if (!u) return `${head}<p class="note">${t('Checking for a new version…')}</p>`;
  const why = u.reason && REASON[u.reason] ? `<p class="note warnText">${REASON[u.reason]}${u.error ? ` <span class="mono">${esc(u.error)}</span>` : ''}${u.how ? `<br><span class="mono">${esc(u.how)}</span>` : ''}</p>` : '';
  if (!u.available && why) return `${head}<p class="note">${t('Version {v}.', { v: esc(u.current) })}</p>${why}`;
  if (!u.available) return `${head}<p class="note">${t('Version {v}: up to date.', { v: esc(u.current) })} ${u.checkedAt ? t('Checked {when}.', { when: new Date(u.checkedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) }) : ''}</p>${why}`;
  return `${head}<div class="updateCard"><p><b>${t('Version {v} is available', { v: esc(u.latest) })}</b> <span class="note">${t('(now {v}, {n} changes)', { v: esc(u.current), n: u.behind })}</span></p>
    ${u.notes?.length ? `<ul class="list note">${u.notes.map((x) => `<li>${x.version ? `<b>${esc(x.version)}</b> ` : ''}${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${why}
    ${u.canUpdate ? `<div class="row"><span class="note grow">${t('The server restarts for a few seconds; agents in their terminals keep working.')}</span><button class="gold" data-uapply>${t('Update now')}</button></div>` : ''}</div>`;
}

export function bindUpdate(box, onState) {
  if (!box || box.dataset.bound) return;                   // one listener, however often the card is redrawn
  box.dataset.bound = '1';
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.ucheck !== undefined) { b.disabled = true; onState(await api('POST', '/api/update/check', {})); return; }
      if (b.dataset.uapply !== undefined) {
        if (b.disabled || !confirm(t('Update The AI Squad now? The server restarts for a few seconds.'))) return;
        b.disabled = true; b.textContent = t('Updating…');
        const r = await api('POST', '/api/update', {});
        toast(t('Updated to {v}; restarting…', { v: r.to }), 8000);
        waitForServer(r.to);
      }
    } catch (err) { b.disabled = false; toast(tx(err.message), 7000); }
  });
}
// reload once the new version answers (up to 2 minutes)
function waitForServer(want) {
  const t0 = Date.now();
  const poll = async () => {
    try { const v = await (await fetch('/api/version', { cache: 'no-store' })).json(); if (v.version === want) return location.reload(); } catch { /* restarting */ }
    if (Date.now() - t0 < 120000) setTimeout(poll, 1500); else toast(t('The server did not come back: run aisquad start on the machine.'), 10000);
  };
  setTimeout(poll, 2500);
}
