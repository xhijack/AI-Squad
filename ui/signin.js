// SPDX-License-Identifier: Apache-2.0
// Menu → Claude sign-in: how background runs (jobs, audits) sign in to Claude. Interactive agents always use this
// machine's `claude` login. The API key is write-only: the browser sends it once and only sees its last 4 characters.
import { esc, api, toast, openModal, closeModal, segHtml, bindSegs, segValue } from './lib.js';
import { ctx } from './ctx.js';
import { t } from './i18n.js';

async function signinDialog() {
  const a = await api('GET', '/api/auth');
  const body = openModal(`<div class="mHead"><h3 class="grow">${t('Claude sign-in')}</h3><button class="ghost iconBtn" data-close aria-label="${t('Close')}">×</button></div>
    <div class="mBody">
      <p class="note">${t('Agents at a Desk use the <code>claude</code> login of this machine. Background runs (jobs, audits, squad recommendations) can use it too, or an API key, so unattended work is billed to a Console organization with its own spend limits.')}</p>
      <label>${t('Background runs sign in with')}</label>
      ${segHtml('mode', [['subscription', t('This machine\'s Claude login')], ['api-key', t('An API key')]], a.mode)}
      <label for="sKey">${a.key.set ? t('API key: set ····{last4}. Paste a new one to replace it.', { last4: esc(a.key.last4) }) : t('Anthropic API key (sk-ant-…)')}</label>
      <input id="sKey" type="password" autocomplete="off" placeholder="sk-ant-…">
      ${a.key.set ? `<button class="small ghost danger" data-clear>${t('Remove the key')}</button>` : ''}
      <p class="note">${t('The key is kept in <code>~/.aisquad/secrets.json</code> (only you can read it) and given only to background runs. It never goes into a repository, a log or this browser. Read <code>docs/BILLING.md</code> for which to choose.')}</p>
    </div>
    <div class="mFoot"><div class="err grow" id="sErr"></div><button class="ghost" data-close>${t('Cancel')}</button><button class="gold" data-save>${t('Save')}</button></div>`);
  body.querySelectorAll('[data-close]').forEach((x) => x.onclick = () => closeModal());
  bindSegs(body);
  const err = (e) => { body.querySelector('#sErr').textContent = e.message; };
  body.querySelector('[data-clear]')?.addEventListener('click', async () => { try { await api('DELETE', '/api/auth/key'); toast(t('Key removed')); closeModal(); } catch (e) { err(e); } });
  body.querySelector('[data-save]').onclick = async () => {
    try {
      const key = body.querySelector('#sKey').value.trim();
      if (key) await api('PUT', '/api/auth/key', { key });
      await api('PATCH', '/api/auth', { mode: segValue(body, 'mode') });
      closeModal(); toast(t('Saved')); ctx.refresh();
    } catch (e) { err(e); }
  };
}
ctx.actions.signin = () => signinDialog();
