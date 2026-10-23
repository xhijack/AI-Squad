// Panel content for the three places: Lobby, Floor, Desk. Each view returns sections
// { id, title, side, html, count? }; app.js lays them out as side panels (desktop) or sheet tabs (phone).
import { esc, money, ago, gb, avatar, STATE_TEXT } from './lib.js';

const WORKFLOW_TEXT = { 'free-team': 'Free Team', 'squad-sprint': 'Squad Sprint' };
const KIND_TEXT = { question: 'Question', permission: 'Permission', stall: 'Stalled', budget: 'Budget', resource: 'Resources' };

// ---------- Attention ----------
export function attentionHtml(items, { showFloor = true, onDesk = false } = {}) {
  if (!items.length) return '<div class="empty">All clear. Nothing is waiting for you.</div>';
  return items.map((a) => {
    const where = [KIND_TEXT[a.kind] || a.kind, showFloor && a.floorNumber ? `Floor ${a.floorNumber} · ${esc(a.floorName)}` : '', a.agentName ? esc(a.agentName) : ''].filter(Boolean).join(' · ');
    let body = '';
    if (a.answerable && a.options?.length) {
      body = `<div class="opts">${a.options.map((o) => o.free
        ? `<form class="free" data-act="answer-free" data-id="${a.id}" data-n="${o.n}"><input name="text" placeholder="${esc(o.label)}" aria-label="Your answer" required><button class="gold">Send</button></form>`
        : `<button data-act="answer" data-id="${a.id}" data-n="${o.n}">${o.n}. ${esc(o.label)}</button>`).join('')}</div>`;
    } else if (a.kind === 'question') {
      body = `${a.options?.length ? `<ol class="note">${a.options.map((o) => `<li>${esc(o.label)}</li>`).join('')}</ol>` : ''}<div class="note">Answer it in the agent's terminal (not started from The AI Squad).</div>`;
    }
    const links = [];
    if (a.floorId && a.agentId && !onDesk) links.push(`<a href="#/floor/${a.floorId}/desk/${a.agentId}">Open desk</a>`);
    else if (a.floorId) links.push(`<a href="#/floor/${a.floorId}">Open Floor</a>`);
    if (a.kind === 'stall') links.push(`<button class="small ghost" data-act="dismiss" data-id="${a.id}">Dismiss</button>`);
    return `<div class="att ${a.kind} ${a.level || ''}"><div class="where">${where} · ${ago(a.ts)}</div><div class="q">${esc(a.text)}</div>${body}${links.length ? `<div class="row" style="margin-top:8px">${links.join(' ')}</div>` : ''}</div>`;
  }).join('');
}

function resourcesHtml(r) {
  if (!r) return '';
  const swapPct = r.swap?.total ? Math.round(r.swap.used / r.swap.total * 100) : 0;
  return `<div class="card"><div class="row"><b class="grow">This machine</b><span class="note">load ${r.load?.[0] ?? '-'} · ${r.cpus} CPU</span></div>
    <div class="chips"><span class="chip">RAM free ${gb(r.mem.available)} / ${gb(r.mem.total)}</span><span class="chip">Swap ${swapPct} %</span>${r.disk ? `<span class="chip">Disk free ${gb(r.disk.free)}</span>` : ''}</div>
    ${r.warnings.length ? `<div class="chips">${r.warnings.map((w) => `<span class="chip warn">${esc(w)}</span>`).join('')}</div>` : ''}</div>`;
}

// ---------- Lobby ----------
export function lobbySections(b) {
  const floors = [...b.floors].sort((x, y) => y.number - x.number);
  const floorCards = floors.map((f) => {
    if (f.missing) return `<div class="card floor" style="--c:#5d6687"><div class="row"><span class="num">${f.number}</span><span class="grow"><span class="title">${esc(f.name)}</span><div class="sub ellipsis">${esc(f.error)}: ${esc(f.path)}</div></span>
      <button class="small danger ghost" data-act="remove-floor" data-floor="${f.id}">Remove</button></div></div>`;
    const c = f.counts;
    const budget = f.budget?.usd > 0 ? `<span class="chip ${f.budget.level === 'over' ? 'bad' : f.budget.level === 'warn' ? 'warn' : ''}">budget ${Math.round(f.budget.pct)} %</span>` : '';
    return `<a class="card floor click" style="--c:${esc(f.accent)};display:block;color:inherit;text-decoration:none" href="#/floor/${f.id}">
      <div class="row"><span class="num">${f.number}</span><span class="grow"><span class="title">${esc(f.name)}</span><div class="sub ellipsis">${esc(f.goal || f.path)}</div></span><span class="lamp ${f.lamp}" title="${esc(f.lamp)}"></span></div>
      <div class="chips"><span class="chip">${f.agents.length} agent${f.agents.length === 1 ? '' : 's'}</span>${c.working ? `<span class="chip ok">${c.working} working</span>` : ''}${c.waiting ? `<span class="chip bad">${c.waiting} waiting</span>` : ''}
        <span class="chip">today ${money(f.cost.today)}</span>${budget}${f.updates ? `<span class="chip info">${f.updates} update${f.updates === 1 ? '' : 's'}</span>` : ''}${f.workflow === 'squad-sprint' ? '<span class="chip">Squad Sprint</span>' : ''}</div></a>`;
  }).join('');
  const detected = b.detected.map((p, i) => `<div class="card"><div class="row"><span class="grow"><span class="title">${esc(p.name)}</span><div class="sub ellipsis" title="${esc(p.root)}">${esc(p.root)}</div></span>
      ${p.hasFloorConfig ? `<button class="small gold" data-act="adopt" data-i="${i}">Register Floor</button>` : `<button class="small gold" data-act="from-detected" data-i="${i}">Create Floor</button>`}</div>
      <div class="chips"><span class="chip">${p.sessions} session${p.sessions === 1 ? '' : 's'}</span><span class="chip">active ${ago(p.lastActive)}</span>${p.team ? `<span class="chip info">team ${esc(p.team)}</span>` : ''}${p.agentDefs.length ? `<span class="chip">${p.agentDefs.length} agent file${p.agentDefs.length === 1 ? '' : 's'}</span>` : ''}${p.hasFloorConfig ? '<span class="chip ok">has Floor config</span>' : ''}</div></div>`).join('');
  return [
    { id: 'floors', title: 'Floors', side: 'left', count: b.floors.length, html: `
      <div class="sectionHead"><h3 class="grow">Floors</h3><button class="small gold" data-act="new-floor">+ New Floor</button></div>
      ${floorCards || '<div class="empty">No Floors yet. Create one, or turn a detected project into a Floor.</div>'}` },
    { id: 'attention', title: 'Attention', side: 'right', count: b.attention.length, countClass: b.attention.length ? 'bad' : '', html: `
      <div class="sectionHead"><h3 class="grow">Attention</h3></div>${attentionHtml(b.attention)}
      <div class="section">${resourcesHtml(b.resources)}</div>` },
    { id: 'detected', title: 'Detected', side: 'left', count: b.detected.length, html: `
      <div class="sectionHead"><h3 class="grow">Detected projects</h3></div>
      <p class="note" style="margin-top:0">Directories with Claude Code activity that are not Floors yet.</p>
      ${detected || '<div class="empty">Nothing new detected.</div>'}` },
  ];
}

// ---------- Floor ----------
function agentRow(floorId, a, selected) {
  const ts = a.templateStatus || {};
  return `<div class="card click agentCard" data-href="#/floor/${floorId}/desk/${a.id}" ${selected ? 'style="border-color:var(--accent)"' : ''}>
    <div class="agent">${avatar(a)}<div class="meta"><div class="name"><span class="ellipsis">${esc(a.displayName)}</span>${a.lead ? '<span class="badge lead">lead</span>' : ''}${ts.updateAvailable ? '<span class="badge update">update</span>' : ''}</div>
      <div class="act"><i class="dot ${a.state}"></i> ${esc(STATE_TEXT[a.state])}${a.activity && a.state !== 'stopped' ? ` · ${esc(a.activity)}` : ''}</div></div>
      ${a.running ? `<button class="small ghost" data-act="stop" data-agent="${a.id}" title="Stop">Stop</button>` : `<button class="small ok" data-act="start" data-agent="${a.id}" title="Start">Start</button>`}</div>
    <div class="chips"><span class="chip">${esc(a.title)}</span><span class="chip">${esc(a.model)}</span>${a.costToday ? `<span class="chip">today ${money(a.costToday)}</span>` : ''}${a.work && !a.work.doneAt ? '<span class="chip info">has work</span>' : a.work?.doneAt ? '<span class="chip ok">work done</span>' : ''}</div></div>`;
}

function feedHtml(feed) {
  if (!feed.length) return '<div class="empty">No activity yet. Start an agent and give it a task.</div>';
  return `<ul class="feed">${feed.map((e) => `<li><span class="k ${e.kind}"></span><div class="grow"><div><b>${esc(e.agentName)}</b> ${esc(e.title)}</div>${e.detail && e.kind !== 'think' ? `<div class="d mono">${esc(e.detail)}</div>` : e.kind === 'think' ? `<div class="d">${esc(e.detail)}</div>` : ''}<div class="t">${ago(e.ts)}</div></div></li>`).join('')}</ul>`;
}

function messagesHtml(msgs, team) {
  if (!msgs.length) return '<div class="empty">No messages between agents yet.</div>';
  const name = (id) => team.find((a) => a.id === id)?.displayName || id;
  return `<ul class="feed">${msgs.map((m) => `<li><span class="k talk"></span><div class="grow"><div><b>${esc(m.fromName)}</b> → <b>${esc(name(m.to))}</b></div><div class="d">${esc(m.text)}</div><div class="t">${ago(m.ts)}</div></div></li>`).join('')}</ul>`;
}

function boardHtml(f) {
  const col = (title, items) => `<div class="card"><b>${title}</b> <span class="note">${items.length}</span>${items.map((a) => `<div class="card" style="margin-top:6px"><div class="row">${avatar(a)}<div class="grow"><div class="ellipsis"><b>${esc(a.displayName)}</b></div><div class="note">${esc(a.work?.text || '')}</div></div></div></div>`).join('') || '<div class="empty">Empty</div>'}</div>`;
  const ag = f.agents;
  return `<p class="note" style="margin-top:0">Squad Sprint board: work given to agents from The AI Squad.</p>
    ${col('In progress', ag.filter((a) => a.work && !a.work.doneAt))}
    ${col('Done, to review', ag.filter((a) => a.work?.doneAt))}
    ${col('Free', ag.filter((a) => !a.work))}`;
}

export function floorSections(f, deskAgentId = null) {
  if (f.missing) return [{ id: 'team', title: 'Team', side: 'left', html: `<div class="empty">${esc(f.error)}: <code>${esc(f.path)}</code></div><button class="danger" data-act="remove-floor" data-floor="${f.id}">Remove this Floor</button>` }];
  const team = f.agents.map((a) => agentRow(f.id, a, a.id === deskAgentId)).join('');
  const b = f.budget || {};
  const sections = [
    { id: 'team', title: 'Team', side: 'left', count: f.agents.length, html: `
      <div class="row" style="align-items:flex-start"><div class="grow"><h2 style="font-size:18px">${f.number} · ${esc(f.name)}</h2><div class="note">${esc(f.goal || 'No goal yet')}</div></div><span class="lamp ${f.lamp}" style="margin-top:6px"></span></div>
      <div class="chips"><span class="chip">${WORKFLOW_TEXT[f.workflow]}</span><span class="chip">today ${money(f.cost.today)}</span><span class="chip">month ${money(f.cost.month)}</span>${b.usd > 0 ? `<span class="chip ${b.level === 'over' ? 'bad' : b.level === 'warn' ? 'warn' : ''}">budget ${money(b.used)} / ${money(b.usd)} per ${b.period}</span>` : ''}${f.teamName ? `<span class="chip info">Agent Team ${esc(f.teamName)}</span>` : ''}</div>
      <div class="row wrap" style="margin-top:10px"><button class="small" data-act="floor-settings">Settings</button><button class="small" data-act="edit-mode">Edit layout</button><span class="spacer"></span>
        ${f.agents.some((a) => !a.running) ? '<button class="small ok" data-act="start-all">Start all</button>' : ''}${f.agents.some((a) => a.running) ? '<button class="small ghost" data-act="stop-all">Stop all</button>' : ''}</div>
      <div class="section"><div class="sectionHead"><h3 class="grow">Team</h3><button class="small gold" data-act="add-agent">+ Add agent</button></div>
      ${team || '<div class="empty">No agents yet. Add one from a Role Template.</div>'}</div>
      <div class="note" style="margin-top:12px;word-break:break-all">${esc(f.path)}</div>` },
    { id: 'activity', title: 'Activity', side: 'right', html: feedHtml(f.feed || []) },
    { id: 'messages', title: 'Messages', side: 'right', count: (f.messages || []).length, html: messagesHtml(f.messages || [], f.agents) },
  ];
  if (f.workflow === 'squad-sprint') sections.push({ id: 'board', title: 'Board', side: 'right', html: boardHtml(f) });
  const att = f.attentionItems || [];
  if (att.length) sections.unshift({ id: 'f-attention', title: 'Attention', side: 'right', count: att.length, countClass: 'bad', html: attentionHtml(att, { showFloor: false }) });
  return sections;
}

// ---------- Desk ----------
export function deskSections(floor, d, { locked = false } = {}) {
  if (locked) return [{ id: 'desk', title: 'Desk', side: 'right', html: `<div class="empty">This desk shows the agent's live screen and transcript, so it needs the local PIN.</div><button class="gold" data-act="unlock">Enter PIN</button>` }];
  if (!d) return [{ id: 'desk', title: 'Desk', side: 'right', html: '<div class="empty">Loading…</div>' }];
  const e = d.effective || {};
  const ts = d.templateStatus || {};
  const o = d.agent.overrides || {};
  const dialog = d.dialog ? (floor.attentionItems || []).filter((a) => a.agentId === d.id) : [];
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis" style="font-size:18px">${esc(d.displayName)}</h2>
      <div class="note">${esc(e.title || '')} · ${esc(d.model || '')}${d.modelId ? ` (${esc(d.modelId)})` : ''}</div>
      <div class="note"><i class="dot ${d.state}"></i> ${esc(STATE_TEXT[d.state])}${d.activity && d.state !== 'stopped' ? ` · ${esc(d.activity)}` : ''}</div></div>
      ${d.running ? `<button class="ghost" data-act="stop" data-agent="${d.id}">Stop</button>` : `<button class="ok" data-act="start" data-agent="${d.id}">Start</button>`}</div>`;
  const update = ts.updateAvailable ? `<div class="att stall" style="margin-top:10px"><div class="where">Update available</div><div class="q">${esc(e.title)} template v${d.agent.role.version} → v${ts.latestVersion}</div>
      <div class="row wrap"><button class="small" data-act="tpl-diff" data-agent="${d.id}">View diff</button><button class="small gold" data-act="tpl-update" data-agent="${d.id}">Update</button><button class="small" data-act="tpl-keep" data-agent="${d.id}">Keep current</button></div></div>` : '';
  const overview = `${head}${update}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <div class="section"><div class="sectionHead"><h3 class="grow">Send task</h3></div><div data-slot="task"></div>
      ${d.pending ? `<div class="note">Queued: ${esc(d.pending.slice(0, 120))}</div>` : ''}
      ${d.work ? `<div class="note" style="margin-top:6px">Current work (${d.work.doneAt ? `done ${ago(d.work.doneAt)}` : `since ${ago(d.work.assignedAt)}`}): ${esc(d.work.text.slice(0, 160))} <button class="small ghost" data-act="work-done" data-agent="${d.id}">Clear</button></div>` : ''}</div>
    <div class="section note">Terminal: <code>${esc(d.attach)}</code> <button class="small ghost" data-act="copy" data-text="${esc(d.attach)}">Copy</button></div>`;
  const screen = d.running ? `<pre class="screen" data-scroll="screen">${esc(d.screen) || ' '}</pre>` : '<div class="empty">The agent is stopped. Start it to see its live screen.</div>';
  const events = d.events.length ? `<ul class="feed">${d.events.map((ev) => `<li><span class="k ${ev.kind}"></span><div class="grow"><div><b>${esc(ev.title)}</b>${ev.tool ? ` <span class="note">${esc(ev.tool)}</span>` : ''}</div><div class="d ${ev.kind === 'think' || ev.kind === 'task' ? '' : 'mono'}">${esc(ev.detail)}</div><div class="t">${ago(ev.ts)}</div></div></li>`).join('')}</ul>` : '<div class="empty">No transcript yet.</div>';
  const pills = (list, cls = '') => list.map((s) => `<span class="pill ${cls}">${esc(s)}</span>`).join('');
  const profile = `<dl class="kv">
      <dt>Agent id</dt><dd><code>${esc(d.id)}</code></dd>
      <dt>Role</dt><dd>${esc(e.title)} ${d.agent.role.detached ? '<span class="badge">detached copy</span>' : `<span class="badge">${esc(d.agent.role.template)}@${d.agent.role.version}</span>`}${ts.keptVersion ? ` <span class="note">kept (v${ts.keptVersion} available)</span>` : ''}</dd>
      <dt>Model</dt><dd>${esc(e.model)}${o.model ? ' <span class="note">(override)</span>' : ''}</dd>
      <dt>Effort</dt><dd>${esc(e.effort)}${o.effort ? ' <span class="note">(override)</span>' : ''}</dd>
      <dt>Skills</dt><dd>${pills((e.skills || []).filter((s) => !(o.skills?.add || []).includes(s)))}${pills(o.skills?.add || [], 'add')}${pills(o.skills?.remove || [], 'rm')}${(e.skills || []).length || (o.skills?.remove || []).length ? '' : '<span class="note">none</span>'}</dd>
      <dt>Tools</dt><dd>${pills(e.tools || []) || '<span class="note">all</span>'}</dd>
      <dt>Not allowed</dt><dd>${pills(e.permissions?.deny || [])}</dd>
      <dt>Rules</dt><dd>${(e.rules || []).length ? `<ul style="margin:0;padding-left:18px">${e.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<span class="note">none</span>'}${o.rules?.length ? `<div class="note">${o.rules.length} added by override</div>` : ''}</dd>
      <dt>Cost today</dt><dd>${money(d.costToday)}</dd>
    </dl>
    ${o.prompt ? `<details><summary>Prompt override</summary><div class="note" style="white-space:pre-wrap">${esc(o.prompt)}</div></details>` : ''}
    <details><summary>Full prompt</summary><div class="note" style="white-space:pre-wrap">${esc(e.prompt)}</div></details>
    <div class="actions" style="justify-content:flex-start"><button data-act="edit-agent" data-agent="${d.id}">Edit agent</button>
      ${d.agent.role.detached ? '' : `<button class="ghost" data-act="tpl-detach" data-agent="${d.id}">Detach from template</button>`}
      <button class="ghost danger" data-act="remove-agent" data-agent="${d.id}">Remove</button></div>`;
  return [
    { id: 'desk', title: 'Desk', side: 'right', count: dialog.length || undefined, countClass: 'bad', html: overview },
    { id: 'screen', title: 'Screen', side: 'right', html: screen },
    { id: 'transcript', title: 'Transcript', side: 'right', html: events },
    { id: 'profile', title: 'Profile', side: 'right', html: profile },
  ];
}
