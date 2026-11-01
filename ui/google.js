// SPDX-License-Identifier: Apache-2.0
// The Google connector (1.8). Admin → Integrations → Google (the Owner's): the service account's key as a write-only
// upload (only its client e-mail is shown), the optional PageSpeed and Bing keys, and the Owner's own properties
// (Owner-only Spaces may use them). Floor settings → Google: the Space's Search Console site, GA4 property, site and
// IndexNow key (.claude/aisquad/google.json, ids only), and Test: what the service account can read and how to grant it.
import { esc, api, toast, ago } from './lib.js';
import { t } from './i18n.js';

export function googleAdminHtml(g) {
  if (!g) return '';
  const o = g.owner || {};
  return `<div class="section" data-google><div class="sectionHead"><span class="badge">${t('built in')}</span><h3 class="grow">Google</h3>${g.set ? `<span class="badge live">${t('connected')}</span>` : `<span class="badge">${t('no key yet')}</span>`}</div>
    <p class="note">${t('Free, read-only data for search targets and the SEO & GEO agents: Search Console, GA4, URL Inspection, PageSpeed Insights, Bing Webmaster and IndexNow. No extra service runs; the server calls Google itself, and agents ask the server.')}</p>
    <div class="note">${g.set ? t('Service account: {email}', { email: `<b class="mono">${esc(g.clientEmail)}</b>` }) + (g.setAt ? ` · ${t('set {ago}', { ago: ago(g.setAt) })}` : '') : t('Create a service account in Google Cloud, enable the Search Console API and the Google Analytics Data API, add a JSON key and upload it here (README → Google connector).')}</div>
    <div class="row wrap"><input type="file" accept=".json,application/json" data-gkeyfile aria-label="${t('Service account key (JSON)')}">${g.set ? `<button class="small ghost danger" data-gkeyclear>${t('Remove')}</button>` : ''}</div>
    <p class="note">${t('The key stays on this machine (secrets.json, mode 600). It is never shown again, never written to a repository or the Log, and never given to an agent.')}</p>
    <div class="grid4">
      <label class="span2">${t('PageSpeed API key (optional)')}<input data-gpsi placeholder="${g.psiKey ? t('set') : t('not set: works without, with a lower quota')}" autocomplete="off"></label>
      <label class="span2">${t('Bing Webmaster API key (optional)')}<input data-gbing placeholder="${g.bingKey ? t('set') : t('not set')}" autocomplete="off"></label>
    </div>
    <div class="row"><span class="spacer"></span><button class="small" data-gkeys>${t('Save keys')}</button></div>
    <form data-gowner class="adminRow"><b>${t('Your own properties (Owner-only Spaces may use them)')}</b>
      <div class="grid4"><label class="span2">${t('Search Console site')}<input name="gscSite" value="${esc(o.gscSite || '')}" placeholder="sc-domain:example.com"></label>
        <label>${t('GA4 property id')}<input name="ga4Property" value="${esc(o.ga4Property || '')}" placeholder="312345678"></label>
        <label>${t('Site')}<input name="siteUrl" value="${esc(o.siteUrl || '')}" placeholder="https://www.example.com"></label></div>
      <div class="row"><span class="note grow">${t('A team Space uses only its own properties (Floor settings → Google).')}</span><button class="small gold" type="submit">${t('Save')}</button></div></form>
  </div>`;
}
export function bindGoogleAdmin(body, again) {
  body.addEventListener('change', async (e) => {
    if (e.target.dataset.gkeyfile === undefined) return;
    const f = e.target.files?.[0];
    if (!f) return;
    try { const r = await api('PUT', '/api/integrations/google/key', { key: await f.text() }); e.target.value = ''; await again(t('Service account: {email}', { email: r.clientEmail })); } catch (err) { e.target.value = ''; toast(err.message, 6000); }
  });
  body.addEventListener('click', async (e) => {
    const el = e.target;
    try {
      if (el.dataset.gkeyclear !== undefined) { if (!confirm(t('Remove the Google key? Targets and agents lose Google data until a new one is uploaded.'))) return; await api('DELETE', '/api/integrations/google/key'); return again(t('Key removed')); }
      if (el.dataset.gkeys !== undefined) {
        const box = el.closest('[data-google]');
        for (const [which, sel] of [['psi', '[data-gpsi]'], ['bing', '[data-gbing]']]) { const v = box.querySelector(sel).value.trim(); if (v) await api('PUT', `/api/integrations/google/keys/${which}`, { key: v }); }
        return again(t('Key saved'));
      }
    } catch (err) { toast(err.message, 5000); }
  });
  body.addEventListener('submit', async (e) => {
    if (e.target.dataset.gowner === undefined) return;
    e.preventDefault();
    const v = (n) => e.target.elements[n].value.trim();
    try { await api('PATCH', '/api/integrations/google', { gscSite: v('gscSite'), ga4Property: v('ga4Property'), siteUrl: v('siteUrl') }); await again(t('Saved')); } catch (err) { toast(err.message, 5000); }
  });
}

// Floor settings → Google (the Owner's): its own form, saved on its own button
const testHtml = (r) => [['gsc', 'Search Console'], ['ga4', 'GA4']].map(([k, name]) => { const x = r[k]; return `<div class="note">${name}: ${x.ok ? `<span class="okText">${t('can read {property}', { property: esc(x.property) })}</span>` : `<span class="warnText">${esc(x.error)}</span>${x.grant ? `<div>${esc(x.grant)}</div>` : ''}`}</div>`; }).join('');
export async function loadGoogle(floorId, el, owner) {
  if (!owner) { el.textContent = t('Only the Owner sets the Google properties.'); return; }
  let d; try { d = await api('GET', `/api/floors/${floorId}/google`); } catch (e) { el.textContent = e.message; return; }
  const p = d.props, eff = d.effective;
  const hint = (k) => (!p[k] && eff[k] ? ` <span class="note">${t('(the Owner\'s: {v})', { v: esc(eff[k]) })}</span>` : '');
  el.innerHTML = `<p class="note">${t('Which Search Console site and GA4 property this Space reads. Saved in .claude/aisquad/google.json (ids only, no secrets).')} ${d.clientEmail ? t('Give {email} read access: in Search Console as a user of the property, in GA4 the Viewer role.', { email: `<b class="mono">${esc(d.clientEmail)}</b>` }) : t('No service account yet: upload its key in Admin → Integrations → Google.')}</p>
    <div class="grid2" data-gspace><div><label>${t('Search Console site')}${hint('gscSite')}</label><input data-g="gscSite" value="${esc(p.gscSite)}" placeholder="sc-domain:example.com"></div>
      <div><label>${t('GA4 property id')}${hint('ga4Property')}</label><input data-g="ga4Property" value="${esc(p.ga4Property)}" placeholder="312345678"></div>
      <div><label>${t('Site')}${hint('siteUrl')}</label><input data-g="siteUrl" value="${esc(p.siteUrl)}" placeholder="https://www.example.com"></div>
      <div><label>${t('IndexNow key (docs/seo/INDEXNOW.md)')}</label><input data-g="indexNowKey" value="${esc(p.indexNowKey)}" placeholder="a1b2c3d4e5f6a7b8"></div></div>
    <div class="row"><span class="grow" data-gtestout></span><button type="button" class="small ghost" data-gtest>${t('Test')}</button><button type="button" class="small" data-gsave>${t('Save Google properties')}</button></div>`;
  const read = () => Object.fromEntries([...el.querySelectorAll('[data-g]')].map((i) => [i.dataset.g, i.value.trim()]));
  el.querySelector('[data-gsave]').onclick = async () => { try { await api('PUT', `/api/floors/${floorId}/google`, read()); toast(t('Saved')); } catch (e) { toast(e.message, 6000); } };
  el.querySelector('[data-gtest]').onclick = async (e) => {
    const out = el.querySelector('[data-gtestout]');
    e.target.disabled = true; out.textContent = t('Testing…');
    try { await api('PUT', `/api/floors/${floorId}/google`, read()); out.innerHTML = testHtml(await api('POST', `/api/floors/${floorId}/google/test`, {})); } catch (err) { out.textContent = err.message; }
    e.target.disabled = false;
  };
}
