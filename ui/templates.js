// Role Template editor: list, create, edit (every content change is a new version), version history with diff.
import { esc, api, toast, openModal, closeModal, diffHtml } from './lib.js';
import { lines, commaList } from './forms.js';
import { ctx } from './ctx.js';

const STYLES = ['bob', 'spiky', 'pony', 'buns', 'farmer'];
let meta = null, selected = null;

export async function openTemplates(role = null) {
  meta = await api('GET', '/api/roles');
  selected = role || meta.templates[0]?.role || null;
  draw();
}

function listHtml() {
  return `<div class="tplList">${meta.templates.map((t) => `<button type="button" class="card click" data-pick="${esc(t.role)}" style="width:100%;text-align:left;${t.role === selected ? 'border-color:var(--accent)' : ''}">
      <span class="avatar" style="--shirt:${esc(t.appearance.shirt || '#3d82d6')}">${esc(t.title.slice(0, 2).toUpperCase())}</span>
      <span class="grow"><b>${esc(t.title)}</b><div class="note">${esc(t.role)} · v${t.version} · ${esc(t.model)}${t.writable ? '' : ` · ${esc(t.source)} (read-only)`}</div></span></button>`).join('')}
    <button type="button" class="gold" data-new style="width:100%;margin-top:8px">+ New template</button>
    <button type="button" data-libs style="width:100%;margin-top:8px">Libraries</button></div>`;
}

function editorHtml(t, isNew, versions = []) {
  const ro = t && !t.writable && !isNew;
  t = t || { role: '', title: '', description: '', model: 'sonnet', effort: 'medium', skills: [], tools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'], permissions: { deny: ['Read(./.env)', 'Read(./.env.*)', 'Bash(git push*)'] }, appearance: { style: 'bob', shirt: '#3d82d6' }, rules: [], prompt: '' };
  const dis = ro ? 'disabled' : '';
  return `<form id="tForm" novalidate>
    <div class="row"><h3 class="grow">${isNew ? 'New Role Template' : `${esc(t.title)} <span class="badge">v${t.version}</span>`}</h3></div>
    ${ro ? `<p class="note">This template comes from the "${esc(t.source)}" library and is read-only. <button type="button" class="small" data-copy>Copy to local library</button></p>` : ''}
    <div class="grid2">
      <div><label>Role id (kebab-case)</label><input name="role" value="${esc(t.role)}" ${isNew || ro ? '' : 'readonly'} placeholder="devops-engineer" required></div>
      <div><label>Title</label><input name="title" value="${esc(t.title)}" placeholder="DevOps Engineer" required ${dis}></div>
    </div>
    <label>Description</label><input name="description" value="${esc(t.description)}" ${dis}>
    <div class="grid2">
      <div><label>Model</label><select name="model" ${dis}>${meta.models.map((m) => `<option ${m === t.model ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div><label>Effort</label><select name="effort" ${dis}>${meta.efforts.map((m) => `<option ${m === t.effort ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    </div>
    <label>Skills (comma separated)</label><input name="skills" value="${esc(t.skills.join(', '))}" ${dis}>
    <label>Tools (comma separated, empty = all tools)</label><input name="tools" value="${esc(t.tools.join(', '))}" ${dis}>
    <div class="grid2">
      <div><label>Denied (one per line)</label><textarea name="deny" rows="4" ${dis}>${esc(t.permissions.deny.join('\n'))}</textarea></div>
      <div><label>Allowed (one per line, optional)</label><textarea name="allow" rows="4" ${dis} placeholder="Leave empty for no allow list">${esc((t.permissions.allow || []).join('\n'))}</textarea></div>
    </div>
    <label>Rules (one per line)</label><textarea name="rules" rows="5" ${dis}>${esc(t.rules.join('\n'))}</textarea>
    <label>Prompt</label><textarea name="prompt" rows="10" ${dis}>${esc(t.prompt)}</textarea>
    <label>Default appearance</label><div class="row wrap"><select name="style" style="width:auto" ${dis}>${STYLES.map((s) => `<option ${t.appearance.style === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label class="inline">Shirt <input type="color" name="shirt" value="${esc(t.appearance.shirt || '#3d82d6')}" ${dis}></label></div>
    ${versions.length > 1 ? `<label>Version history</label><div class="row wrap">${versions.slice(1).map((v) => `<button type="button" class="small" data-diff="${v - 1}:${v}">v${v - 1} → v${v}</button>`).join('')}</div><div id="tDiff"></div>` : ''}
    <p class="note">Saving a change creates version ${isNew ? 1 : t.version + 1}. Floors using this template show "Update available"; each agent can update, keep its version, or detach.</p>
  </form>`;
}

async function draw(isNew = false) {
  let t = null, versions = [];
  if (!isNew && selected) ({ template: t, versions } = await api('GET', `/api/roles/${selected}`));
  const body = openModal(`<div class="mHead"><h3 class="grow">Role Templates</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody"><div class="tplLayout">${listHtml()}<div class="tplEdit">${editorHtml(t, isNew, versions)}</div></div></div>
    <div class="mFoot"><div class="err grow" id="tErr"></div><button class="ghost" data-close>Close</button><button class="gold" data-save>${isNew ? 'Create template' : t && !t.writable ? 'Save as new template' : 'Save new version'}</button></div>`);
  body.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closeModal());
  body.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { selected = b.dataset.pick; draw(); });
  body.querySelector('[data-new]').onclick = () => { selected = null; draw(true); };
  body.querySelector('[data-libs]').onclick = () => drawLibraries();
  body.querySelector('[data-copy]')?.addEventListener('click', () => copyTemplate(t.source, t.role));
  body.querySelectorAll('[data-diff]').forEach((b) => b.onclick = async () => {
    const [from, to] = b.dataset.diff.split(':');
    const d = await api('GET', `/api/roles/${selected}/diff?from=${from}&to=${to}`);
    body.querySelector('#tDiff').innerHTML = `<p class="note">v${from} → v${to}</p>${diffHtml(d.diff)}`;
  });
  body.querySelector('[data-save]').onclick = () => save(isNew || (t && !t.writable), t);
}

async function save(create, current) {
  const f = document.getElementById('tForm');
  const v = (n) => f.elements[n].value;
  const allow = lines(v('allow'));
  const input = {
    role: v('role').trim(), title: v('title').trim(), description: v('description').trim(), model: v('model'), effort: v('effort'),
    skills: commaList(v('skills')), tools: commaList(v('tools')), permissions: { deny: lines(v('deny')), ...(allow.length ? { allow } : {}) },
    rules: lines(v('rules')), prompt: v('prompt'), appearance: { style: v('style'), shirt: v('shirt') },
  };
  const err = document.getElementById('tErr');
  if (!input.role || !input.title) { err.textContent = 'Role id and title are required.'; return; }
  if (create && current && input.role === current.role) { err.textContent = 'Pick a new role id for your copy.'; return; }
  try {
    const r = create ? await api('POST', '/api/roles', input) : await api('PUT', `/api/roles/${input.role}`, input);
    toast(r.changed === false ? 'No changes' : `${r.template.title} saved as v${r.template.version}`);
    meta = await api('GET', '/api/roles');
    selected = r.template.role;
    draw();
    ctx.refresh();
  } catch (e) { err.textContent = e.message; }
}

// ---------- shared libraries ----------
async function copyTemplate(library, role) {
  const local = meta.templates.some((x) => x.role === role && x.writable);
  const as = prompt(`Role id for the local copy of ${role}`, local ? `${role}-copy` : role);
  if (!as) return;
  try {
    const r = await api('POST', `/api/libraries/${library}/templates/${role}/copy`, { as: as.trim() });
    toast(`${r.template.title} copied to the local library`);
    meta = await api('GET', '/api/roles');
    selected = r.template.role;
    draw();
  } catch (e) { toast(e.message); }
}

async function drawLibraries(openName = null) {
  const { libraries } = await api('GET', '/api/libraries');
  const lib = libraries.find((l) => l.name === openName);
  const list = lib ? (await api('GET', `/api/libraries/${lib.name}/templates`)).templates : [];
  const body = openModal(`<div class="mHead"><h3 class="grow">Role Templates</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody"><div class="tplLayout">${listHtml()}<div class="tplEdit">
      <h3>Libraries</h3>
      <p class="note">Shared template libraries are read-only. Git libraries are cloned into <code>~/.aisquad/libraries/</code> and pulled when you ask. Copy a template to the local library to change it.</p>
      ${libraries.map((l) => `<div class="card"><div class="row"><b class="grow">${esc(l.name)}</b><span class="chip">${l.templates} template${l.templates === 1 ? '' : 's'}</span></div>
        <div class="note" style="word-break:break-all">${esc(l.url || l.path)}${l.ref ? ` · ${esc(l.ref)}` : ''}</div>
        ${l.version ? `<div class="note">Version <code>${esc(l.version.commit)}</code> · ${esc(new Date(l.version.date).toLocaleString())} · ${esc(l.version.subject)}</div>` : l.kind === 'git' ? '<div class="note">Not cloned yet.</div>' : ''}
        <div class="row wrap" style="margin-top:6px">${l.kind === 'git' ? `<button type="button" class="small" data-pull="${esc(l.name)}">Pull</button>` : ''}<button type="button" class="small" data-browse="${esc(l.name)}">Templates</button><button type="button" class="small ghost danger" data-rmlib="${esc(l.name)}">Remove</button></div>
        ${lib && lib.name === l.name ? `<div style="margin-top:8px">${list.map((t) => `<div class="row" style="margin-top:4px"><span class="grow">${esc(t.title)} <span class="note">${esc(t.role)} · v${t.version}</span></span><button type="button" class="small" data-copylib="${esc(t.role)}">Copy</button></div>`).join('') || '<div class="empty">No templates.</div>'}</div>` : ''}</div>`).join('') || '<div class="empty">No shared libraries yet.</div>'}
      <h3 style="margin-top:16px">Add a library</h3>
      <form id="libForm" novalidate><div class="grid2"><div><label>Name</label><input name="name" placeholder="team" required></div><div><label>Branch (optional)</label><input name="ref" placeholder="main"></div></div>
        <label>Git URL or absolute directory</label><input name="src" placeholder="git@github.com:org/roles.git" spellcheck="false">
        <label>Folder inside the repository (optional; default roles/ when it exists)</label><input name="subdir" placeholder="roles">
        <div class="actions"><button class="gold" type="submit">Add library</button></div></form>
    </div></div></div>
    <div class="mFoot"><div class="err grow" id="tErr"></div><button class="ghost" data-close>Close</button></div>`);
  body.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closeModal());
  body.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { selected = b.dataset.pick; draw(); });
  body.querySelector('[data-new]').onclick = () => { selected = null; draw(true); };
  body.querySelector('[data-libs]').onclick = () => drawLibraries();
  const err = (e) => { document.getElementById('tErr').textContent = e.message; };
  body.querySelectorAll('[data-pull]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Pulling…';
    try { const r = await api('POST', `/api/libraries/${b.dataset.pull}/pull`); toast(`${r.library.name} at ${r.library.version?.commit || 'latest'}`); meta = await api('GET', '/api/roles'); drawLibraries(openName); } catch (e) { err(e); b.disabled = false; b.textContent = 'Pull'; }
  });
  body.querySelectorAll('[data-browse]').forEach((b) => b.onclick = () => drawLibraries(b.dataset.browse === openName ? null : b.dataset.browse));
  body.querySelectorAll('[data-copylib]').forEach((b) => b.onclick = () => copyTemplate(openName, b.dataset.copylib));
  body.querySelectorAll('[data-rmlib]').forEach((b) => b.onclick = async () => {
    if (!confirm(`Remove library ${b.dataset.rmlib}? Local copies of its templates stay.`)) return;
    try { await api('DELETE', `/api/libraries/${b.dataset.rmlib}`); meta = await api('GET', '/api/roles'); drawLibraries(); } catch (e) { err(e); }
  });
  body.querySelector('#libForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, src = f.elements.src.value.trim();
    const input = { name: f.elements.name.value.trim(), ref: f.elements.ref.value.trim(), subdir: f.elements.subdir.value.trim(), ...(/^(https?:|ssh:|git@|file:)/.test(src) || src.endsWith('.git') ? { url: src } : { path: src }) };
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Adding…';
    try { await api('POST', '/api/libraries', input); meta = await api('GET', '/api/roles'); toast('Library added'); drawLibraries(kebabName(input.name)); } catch (e2) { err(e2); btn.disabled = false; btn.textContent = 'Add library'; }
  });
}
const kebabName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
