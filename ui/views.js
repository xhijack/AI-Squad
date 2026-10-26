// Panel content for the three places: Lobby, Floor, Desk. Each view returns sections
// { id, title, card: top | main | tabs, html, head?, count? }; app.js lays them out as floating cards in the right
// panel (desktop) or as tabs of the bottom sheet (phone).
import { esc, money, ago, avatar, STATE_TEXT, stateText, drafts, mdLite } from './lib.js';

const KIND_TEXT = { question: 'Question', permission: 'Permission', reply: 'Waiting for your reply', stall: 'Stalled', budget: 'Budget', resource: 'Resources', merge: 'Merge', crash: 'Stopped unexpectedly', decided: 'Decided by autopilot' };

// ---------- Attention ----------
export function attentionHtml(items, { showFloor = true, onDesk = false } = {}) {
  if (!items.length) return '<div class="empty">All clear. Nothing is waiting for you.</div>';
  return items.map((a) => {
    const where = [KIND_TEXT[a.kind] || a.kind, showFloor && a.floorNumber ? `Floor ${a.floorNumber} · ${esc(a.floorName)}` : '', a.agentName ? esc(a.agentName) : ''].filter(Boolean).join(' · ');
    let body = '';
    if (a.kind === 'reply') {
      const who = esc(String(a.agentName || 'the agent').split(' - ')[0]);
      body = `<form class="replyForm" data-act="reply" data-id="${a.id}"><textarea name="text" rows="3" data-draft="${a.id}" placeholder="Reply to ${who}…" aria-label="Your reply to ${who}" required>${esc(drafts.get(a.id) || '')}</textarea>
        <div class="row"><span class="note grow">Sent to ${who} as the next task.</span><button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}" title="Hide this until the agent asks again">Dismiss</button><button class="small gold">Send reply</button></div></form>`;
    } else if (a.kind === 'decided') {
      // a muted card: what Autopilot chose, the other options to change it, OK to keep it
      body = `<div class="note">Decided automatically: <b>${esc(a.chosen)}</b></div>
        <div class="row wrap" style="margin-top:8px">${a.options.length ? `<span class="note">Change answer:</span>${a.options.map((o) => `<button class="small" data-act="answer" data-id="${a.id}" data-n="${o.n}">${esc(o.label)}</button>`).join('')}` : ''}
        <span class="spacer"></span><button class="small ghost" data-act="dismiss" data-id="${a.id}" title="Keep this decision">OK</button></div>`;
    } else if (a.kind === 'crash') {
      // Resume continues the agent's last session (the default after a crash); Start fresh loses its context
      body = `<div class="row wrap">${a.options.map((o) => `<button class="small ${o.n === 1 ? 'gold' : 'ghost'}" data-act="crash-answer" data-id="${a.id}" data-n="${o.n}">${o.n === 1 ? 'Resume' : 'Start fresh'}</button>`).join('')}
        <button class="small ghost" data-act="dismiss" data-id="${a.id}">Dismiss</button></div>${a.resumable ? '<div class="note" style="margin-top:6px">Resume continues the last session with its context. Start fresh begins a new session.</div>' : ''}`;
    } else if (a.answerable && a.options?.length) {
      body = `<div class="opts">${a.options.map((o) => o.free
        ? `<form class="free" data-act="answer-free" data-id="${a.id}" data-n="${o.n}"><input name="text" placeholder="${esc(o.label)}" aria-label="Your answer" required><button class="gold">Send</button></form>`
        : `<button data-act="answer" data-id="${a.id}" data-n="${o.n}">${o.n}. ${esc(o.label)}</button>`).join('')}</div>`;
    } else if (a.kind === 'permission' && a.live) {
      body = `<div class="note">Reported live by Claude Code. ${a.agentId ? 'Answer it on the Desk (Screen tab) or in the agent\'s terminal.' : ''}</div>`;
    } else if (a.kind === 'question') {
      body = `${a.options?.length ? `<ol class="note">${a.options.map((o) => `<li>${esc(o.label)}</li>`).join('')}</ol>` : ''}<div class="note">Answer it in the agent's terminal (not started from The AI Squad).</div>`;
    }
    const links = [];
    if (a.floorId && a.agentId && !onDesk) links.push(`<a href="#/floor/${a.floorId}/desk/${a.agentId}">Open desk</a>`);
    else if (a.floorId) links.push(`<a href="#/floor/${a.floorId}">Open Floor</a>`);
    if (a.kind === 'stall' || a.kind === 'merge') links.push(`<button class="small ghost" data-act="dismiss" data-id="${a.id}">Dismiss</button>`);
    body = apNote(a) + body;
    const text = a.kind === 'reply' ? `<div class="replyMsg md" data-scroll="reply-${a.id}" tabindex="0" aria-label="Message from ${esc(a.agentName || 'the agent')}">${mdLite(a.text)}</div>` : `<div class="q">${esc(a.text)}</div>`;
    return `<div class="att ${a.kind} ${a.level || ''}${a.muted ? ' muted' : ''}"><div class="where">${where} · ${ago(a.ts)}</div>${text}${body}${links.length ? `<div class="row" style="margin-top:8px">${links.join(' ')}</div>` : ''}</div>`;
  }).join('');
}

// what Autopilot does with an item: critical ones wait for the owner; others are answered or nudged after the timeout
function apNote(a) {
  const ap = a.autopilot;
  if (!ap) return '';
  if (ap.critical) return `<div class="apNote crit">Critical${ap.reasons?.length && ap.reasons[0] !== 'unclear' ? ` (${esc(ap.reasons.join(', ').replace(/-/g, ' '))})` : ''}: Autopilot leaves this to you.</div>`;
  if (!ap.auto) return '';
  const min = Math.max(0, Math.ceil((ap.autoAt - Date.now()) / 60e3));
  const what = a.kind === 'question' ? `answers "${esc(String(a.options.find((o) => o.n === ap.recommended)?.label || '').replace(/\s*\(recommended\)\s*/i, ''))}"` : 'asks the agent to decide';
  return `<div class="apNote">Autopilot ${what} ${min ? `in ${min} min` : 'now'} if you do not.</div>`;
}
export const needsYou = (list) => (list || []).filter((a) => !a.muted);

// ---------- Lobby ----------
// one row per Floor: number badge in the Floor's colour, name, one status line, the lamp
function floorRow(f) {
  if (f.missing) return `<div class="frow missing"><span class="fnum" style="--c:#9ca3af">${f.number}</span><span class="grow"><b>${esc(f.name)}</b><span class="sub">${esc(f.error)}</span></span>
    <button class="small ghost danger" data-act="remove-floor" data-floor="${f.id}">Remove</button></div>`;
  const c = f.counts || {}, n = f.agents.length;
  const line = f.independent
    ? `${n} agent${n === 1 ? '' : 's'} on their own${f.agents.some((a) => a.running) ? ` · ${f.agents.filter((a) => a.running).length} live` : ''}`
    : `${n} agent${n === 1 ? '' : 's'}${c.working ? ` · ${c.working} working` : ''}${f.workflow === 'squad-sprint' ? ' · Squad Sprint' : ''} · today ${money(f.cost.today)}`;
  const flag = c.waiting ? `<span class="st waiting">${c.waiting} need${c.waiting === 1 ? 's' : ''} you</span>` : f.budget?.level === 'over' ? '<span class="st waiting">budget</span>' : f.budget?.level === 'warn' ? '<span class="st idle">budget</span>' : '';
  return `<a class="frow" href="#/floor/${f.id}"><span class="fnum" style="--c:${esc(f.accent)}">${f.number}</span><span class="grow"><b>${esc(f.name)}</b><span class="sub">${esc(line)}</span></span>${flag}<span class="lamp ${f.lamp}" title="${esc(f.lamp)}"></span></a>`;
}

export function lobbySections(b) {
  const floors = [...b.floors].sort((x, y) => y.number - x.number);
  const detected = b.detected.map((p, i) => `<div class="frow"><span class="grow"><b>${esc(p.name)}</b><span class="sub" title="${esc(p.root)}">${p.sessions} session${p.sessions === 1 ? '' : 's'} · active ${ago(p.lastActive)}${p.team ? ` · team ${esc(p.team)}` : ''}</span></span>
      ${p.hasFloorConfig ? `<button class="small" data-act="adopt" data-i="${i}">Register</button>` : `<button class="small" data-act="from-detected" data-i="${i}">Create Floor</button>`}</div>`).join('');
  const out = [
    { id: 'floors', title: 'Floors', card: 'main', count: b.floors.length, html: `
      <button class="setupBtn" data-act="setup-squad"><svg><use href="#i-spark"/></svg><span><b>Set up Squad</b><small>Describe what you want to build; get a team and how it works together</small></span></button>
      ${b.autopilotToday ? `<p class="note apDigest">Decided by autopilot today: <b>${b.autopilotToday}</b> <span class="note">(see each Floor's Squad Log)</span></p>` : ''}
      <div class="list">${floors.map(floorRow).join('') || '<div class="empty">No Floors yet.</div>'}</div>
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="small ghost" data-act="new-floor" title="A Floor without a Blueprint, set up by hand">+ New Floor by hand</button></div>` },
    { id: 'detected', title: 'Detected', card: 'main', count: b.detected.length, html: `
      <p class="note" style="margin-top:0">Directories with Claude Code activity that are not Floors yet.</p>
      <div class="list">${detected || '<div class="empty">Nothing new detected.</div>'}</div>` },
  ];
  if (b.attention.length) out.unshift({ id: 'attention', title: 'Needs you', card: 'top', count: needsYou(b.attention).length || undefined, countClass: 'bad', html: attentionHtml(b.attention) });
  return out;
}

// ---------- Floor ----------
const ROLE_SHORT = (a) => [a.lead ? 'Lead' : '', a.title, a.model].filter(Boolean).join(' · ');
const STATE_SHORT = { working: 'working', waiting: 'needs you', idle: 'idle', stopped: 'stopped' };
// one row per agent: colour dot, name, role, one status chip, what it is doing
export function agentRow(floorId, a, selected) {
  const act = a.standby ? a.activity : a.crash && !a.crash.withLead ? a.crash.text : a.stopNote ? `${a.stopNote}${a.lastTs ? ` · ${ago(a.lastTs)}` : ''}`
    : a.state === 'stopped' ? (a.independent ? a.activity || 'not running' : `stopped${a.lastTs ? ` · last seen ${ago(a.lastTs)}` : ''}`)
    : a.state === 'idle' ? `idle${a.lastTs ? ` ${ago(a.lastTs).replace(' ago', '')}` : ''}` : a.activity || STATE_TEXT[a.state];
  return `<div class="arow${selected ? ' sel' : ''}" data-href="#/floor/${floorId}/desk/${a.id}" role="button" tabindex="0">
    <i class="adot" style="--c:${esc(a.appearance?.shirt || '#3d82d6')}"></i>
    <span class="grow"><span class="nm"><b>${esc(String(a.displayName).split(' - ')[0])}</b> <span class="role">${esc(ROLE_SHORT(a))}</span></span><span class="act">${esc(act)}</span></span>
    ${a.standby ? '<span class="st standby">not started</span>' : a.crash && !a.crash.withLead ? '<span class="st crashed">crashed</span>' : `<span class="st ${a.state}">${STATE_SHORT[a.state]}</span>`}</div>`;
}

function feedHtml(feed) {
  if (!feed.length) return '<div class="empty">No activity yet. Start an agent and give it a task.</div>';
  const hm = (ts) => new Date(ts).toTimeString().slice(0, 5);
  return `<ul class="feed">${feed.map((e) => `<li title="${esc(e.detail || '')}"><span class="t">${hm(e.ts)}</span><span class="k ${e.kind}"></span><span class="grow ellipsis"><b>${esc(String(e.agentName).split(' - ')[0])}</b> ${esc(e.title)}${e.detail && e.kind !== 'think' ? ` <span class="d">· ${esc(e.detail.split('\n')[0])}</span>` : ''}</span></li>`).join('')}</ul>`;
}

function messagesHtml(msgs, team) {
  if (!msgs.length) return '<div class="empty">No messages between agents yet.</div>';
  const name = (id) => String(team.find((a) => a.id === id)?.displayName || id).split(' - ')[0];
  return `<ul class="feed msgs">${msgs.map((m) => `<li><span class="t">${new Date(m.ts).toTimeString().slice(0, 5)}</span><span class="k talk"></span><span class="grow"><b>${esc(String(m.fromName).split(' - ')[0])}</b> → <b>${esc(name(m.to))}</b> <span class="d">${esc(m.text)}</span></span></li>`).join('')}</ul>`;
}

const COLUMN_TEXT = { TODO: 'To do', IN_PROGRESS: 'In progress', REVIEW: 'Review', BLOCKED: 'Blocked / bugs', DONE: 'Done' };
const COLUMN_COLOR = { TODO: '#9ca3af', IN_PROGRESS: '#2563eb', REVIEW: '#7c3aed', BLOCKED: '#dc2626', DONE: '#16a34a' };
export function boardHtml(f) {
  const b = f.board;
  if (!b || !b.pack) return '<div class="empty">The Squad Sprint pack is not set up on this Floor yet. Save the Floor settings with the Squad Sprint workflow to scaffold it.</div>';
  const name = (id) => String(f.agents.find((a) => a.id === id)?.displayName || id).split(' - ')[0];
  const cols = Object.keys(COLUMN_TEXT).map((c) => {
    const items = b.tasks.filter((t) => t.column === c);
    return `<div class="kcol"><h4><i style="background:${COLUMN_COLOR[c]}"></i>${COLUMN_TEXT[c]}<span class="c">${items.length}</span></h4>${items.map((t) => `<div class="kcard" style="border-top-color:${COLUMN_COLOR[c]}"><b>${esc(t.task)}</b>
      <div class="note">${esc(name(t.owner))}${t.blockedBy ? ` · after ${esc(t.blockedBy)}` : ''}${t.status && t.status.toUpperCase() !== c ? ` · ${esc(t.status)}` : ''}</div></div>`).join('') || '<div class="empty">Empty</div>'}</div>`;
  }).join('');
  return `<div class="chips" style="margin-top:0">${b.sprint ? `<span class="chip info">Sprint ${esc(b.sprint)}</span>` : ''}<span class="chip">${b.tasks.length} tasks</span>
      ${b.bugs.open.length ? `<span class="chip bad">${b.bugs.open.length} open bug${b.bugs.open.length === 1 ? '' : 's'}</span>` : ''}${b.bugs.fixed.length ? `<span class="chip warn">${b.bugs.fixed.length} to retest</span>` : ''}
      ${b.sprint ? `<span class="chip ok">${b.qa.pass.length} QA pass</span>` : ''}${b.questions ? `<span class="chip">${b.questions} questions</span>` : ''}
      <span class="note">From <code>${esc(b.source || 'docs/squad/TASKS.md')}</code>; the lead keeps it current.</span></div>
    ${b.tasks.length ? `<div class="kcols">${cols}</div>` : '<div class="empty">No tasks yet. Start the lead and run <code>/sprint</code> to plan the sprint.</div>'}`;
}

// the Blueprint this squad follows and the state of its source documents
const DOC_STATE = { approved: ['ok', 'approved'], draft: ['warn', 'draft'], missing: ['bad', 'missing'] };
function standardHtml(bp) {
  const pending = bp.sourceDocs.filter((d) => d.status !== 'approved').length;
  return `<div class="row" style="margin-bottom:8px"><b class="grow">${esc(bp.title)} v${bp.version}</b>${pending ? `<span class="st idle">${pending} not approved</span>` : '<span class="st working">all approved</span>'}</div>
    ${bp.latest > bp.version ? `<div class="row" style="margin-bottom:8px"><span class="chip info grow">Blueprint v${bp.latest} available</span><button class="small" data-act="blueprint-update">Update</button></div>` : ''}
    <p class="note" style="margin-top:0">Roles, channels, gates and the definition of done are in <code>AISQUAD.md</code> and in every agent's prompt.${pending ? ' The lead collects the source documents from you first.' : ''}</p>
    ${bp.sourceDocs.map((d) => `<div class="docRow"><span class="grow"><code>${esc(d.path)}</code><span class="note">${esc(d.purpose)}</span></span><span class="chip ${DOC_STATE[d.status][0]}">${DOC_STATE[d.status][1]}</span></div>`).join('')}
    <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="small ${pending ? 'gold' : ''}" data-act="source-docs">${pending ? 'Review and approve' : 'Open source documents'}</button></div>`;
}

const agentsHead = (f, extra = '') => `<div class="cardHead"><h3>Agents</h3><span class="meta">${f.agents.filter((a) => a.state === 'working' || a.state === 'waiting').length}/${f.agents.length} active</span>${extra}</div>`;

function independentFloorSections(f, deskAgentId) {
  const sections = [
    { id: 'agents', title: 'Agents', card: 'main', head: agentsHead(f, '<button class="small ghost" data-act="rescan" title="Look for agents again">Rescan</button>'), count: f.agents.length,
      html: `<div class="list">${f.agents.map((a) => agentRow(f.id, a, a.id === deskAgentId)).join('') || '<div class="empty">No independent agents right now. Agents you run yourself in a terminal, tmux or VS Code show up here.</div>'}</div>
      <p class="note">Claude Code agents already running on this machine (processes, tmux panes, recent transcripts). The AI Squad only watches them; open one and <b>Adopt</b> it into a squad.</p>` },
    { id: 'activity', title: 'Activity', icon: 'activity', card: 'tabs', html: feedHtml(f.feed || []) },
  ];
  const att = f.attentionItems || [];
  if (att.length) sections.unshift({ id: 'f-attention', title: 'Needs you', card: 'top', count: needsYou(att).length || undefined, countClass: 'bad', html: attentionHtml(att, { showFloor: false }) });
  return sections;
}

export function floorSections(f, deskAgentId = null) {
  if (f.independent) return independentFloorSections(f, deskAgentId);
  if (f.missing) return [{ id: 'agents', title: 'Floor', card: 'main', html: `<div class="empty">${esc(f.error)}: <code>${esc(f.path)}</code></div><button class="danger" data-act="remove-floor" data-floor="${f.id}">Remove this Floor</button>` }];
  const sections = [
    { id: 'agents', title: 'Agents', card: 'main', head: agentsHead(f), count: f.agents.length,
      html: `<div class="list">${f.agents.map((a) => agentRow(f.id, a, a.id === deskAgentId)).join('') || '<div class="empty">No agents yet. <button class="small gold" data-act="add-agent">Add an agent</button></div>'}</div>` },
    { id: 'activity', title: 'Activity', icon: 'activity', card: 'tabs', html: feedHtml(f.feed || []) },
    { id: 'messages', title: 'Messages', icon: 'chat', card: 'tabs', count: (f.messages || []).length, html: messagesHtml(f.messages || [], f.agents) },
  ];
  if (f.blueprint) sections.push({ id: 'standard', title: 'Standard', icon: 'doc', card: 'tabs', html: standardHtml(f.blueprint) });
  const att = f.attentionItems || [];
  if (att.length) sections.unshift({ id: 'f-attention', title: 'Needs you', card: 'top', count: needsYou(att).length || undefined, countClass: 'bad', html: attentionHtml(att, { showFloor: false }) });
  return sections;
}

// ---------- Desk ----------
// the status line under the agent's name: state, then what it is doing (a standby text says it all)
const deskState = (d) => (d.standby ? d.activity.replace(/^./, (c) => c.toUpperCase())
  : d.crash && !d.crash.withLead ? d.crash.text : d.stopNote ? d.stopNote.replace(/^./, (c) => c.toUpperCase())
  : `${stateText(d)}${d.activity && d.state !== 'stopped' && !d.waitingReply ? ` · ${d.activity}` : ''}`);
const SKILL_STATE = { project: ['ok', 'in project'], user: ['ok', 'in user skills'], bundled: ['info', 'from plugin'], missing: ['warn', 'not installed'] };
function skillsHtml(d) {
  const list = d.skills || [];
  if (!list.length) return '';
  const added = new Set(d.agent?.overrides?.skills?.add || []);
  const installable = list.filter((s) => s.installable).map((s) => s.name);
  return `<div class="skillList">${list.map((s) => `<div class="skillRow" title="${esc(s.description)}"><span class="pill ${added.has(s.name) ? 'add' : ''}">${esc(s.name)}</span>
      <span class="chip ${SKILL_STATE[s.status][0]}">${SKILL_STATE[s.status][1]}</span>${s.installable ? `<button class="small ghost" data-act="install-skill" data-skill="${esc(s.name)}" title="Copy the bundled skill into .claude/skills of this project">Install</button>` : ''}</div>`).join('')}</div>
    ${installable.length > 1 ? `<button class="small" data-act="install-skill" data-skill="${esc(installable.join(','))}">Install all ${installable.length} into the project</button>` : ''}
    <div class="note">Plugin skills work in sessions The AI Squad starts; installing copies them into <code>.claude/skills/</code> so every session of this project has them.</div>`;
}
function independentDeskSections(floor, d, routeScreen) {
  const dialog = (floor.attentionItems || []).filter((a) => a.agentId === d.id && (d.dialog || a.kind === 'reply'));
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis" style="font-size:18px">${esc(d.displayName)}</h2>
      <div class="note">${esc(d.title)}${d.models?.observed ? ` · last reply from ${esc(d.models.observed)}` : ''}</div>
      <div class="note"><i class="dot ${d.standby ? 'standby' : d.state}"></i> ${esc(deskState(d))}</div></div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px"><button class="gold" data-act="adopt-agent" data-agent="${d.id}">Adopt into a squad</button>
      <a class="chip" style="justify-content:center" href="#/floor/${floor.id}/desk/${d.id}${routeScreen ? '' : '/screen'}">${routeScreen ? 'Leave screen' : 'Look at screen'}</a></div></div>`;
  const overview = `${head}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <dl class="kv" style="margin-top:12px"><dt>Directory</dt><dd><code>${esc(d.root)}</code></dd><dt>Runs in</dt><dd>${esc(d.via)}${d.pid ? ` <span class="note">pid ${d.pid}</span>` : ''}</dd><dt>Cost today</dt><dd>${money(d.costToday)}</dd></dl>
    <p class="note">An independent agent: The AI Squad shows its status, screen, transcript and questions, but does not start, stop or give it tasks. Adopt it to make it a member of a squad.</p>
    ${d.attach ? `<div class="section note">Terminal: <code>${esc(d.attach)}</code> <button class="small ghost" data-act="copy" data-text="${esc(d.attach)}">Copy</button></div>` : ''}`;
  const screen = d.screen ? `<pre class="screen" data-scroll="screen">${esc(d.screen)}</pre>` : `<div class="empty">${d.running ? 'This agent does not run in tmux, so its screen cannot be shown. Its transcript is in the Transcript tab.' : 'No Claude Code process is running for this agent.'}</div>`;
  const events = d.events.length ? `<ul class="feed events">${d.events.map((ev) => `<li><span class="k ${ev.kind}"></span><div class="grow"><div><b>${esc(ev.title)}</b>${ev.tool ? ` <span class="note">${esc(ev.tool)}</span>` : ''}</div><div class="d ${ev.kind === 'think' || ev.kind === 'task' ? '' : 'mono'}">${esc(ev.detail)}</div><div class="t">${ago(ev.ts)}</div></div></li>`).join('')}</ul>` : '<div class="empty">No transcript yet.</div>';
  return [
    { id: 'desk', title: 'Desk', card: 'main', count: dialog.length || undefined, countClass: 'bad', html: overview },
    { id: 'screen', title: 'Screen', card: 'main', html: screen },
    { id: 'transcript', title: 'Transcript', card: 'main', html: events },
  ];
}

// stopped: Resume is the main action after a crash; otherwise Start, with Resume of the last session beside it
function startButtons(d) {
  if (d.running) return `<button class="ghost" data-act="stop" data-agent="${d.id}">Stop</button>`;
  if (d.crash && !d.crash.withLead && d.resume) return `<button class="gold" data-act="resume" data-agent="${d.id}" title="Continue the last session">Resume</button><button class="ghost small" data-act="start" data-agent="${d.id}" title="A new session without the earlier context">Start fresh</button>`;
  return `<button class="ok" data-act="start" data-agent="${d.id}">Start</button>${d.resume ? `<button class="ghost small" data-act="resume" data-agent="${d.id}" title="Continue the last session (${esc(d.resume.sessionId.slice(0, 8))})">Resume last session</button>` : ''}`;
}

export function deskSections(floor, d, opts = {}) {
  return deskSectionsInner(floor, d, opts).map((x) => ({ ...x, back: `#/floor/${floor.id}` }));
}
function deskSectionsInner(floor, d, { locked = false, screen: routeScreen = false } = {}) {
  if (locked) return [{ id: 'desk', title: 'Desk', card: 'main', html: `<div class="empty">This desk shows the agent's live screen and transcript, so it needs the local PIN.</div><button class="gold" data-act="unlock">Enter PIN</button>` }];
  if (!d) return [{ id: 'desk', title: 'Desk', card: 'main', html: '<div class="empty">Loading…</div>' }];
  if (d.independent) return independentDeskSections(floor, d, routeScreen);
  const e = d.effective || {};
  const ts = d.templateStatus || {};
  const o = d.agent.overrides || {};
  const dialog = (floor.attentionItems || []).filter((a) => a.agentId === d.id && (d.dialog || a.kind === 'reply'));
  const mr = d.models || {};
  const modelWarn = mr.mismatch
    ? `<div class="att budget warn" style="margin-top:10px"><div class="where">Model differs</div><div class="q">Configured: <b>${esc(mr.configured)}</b>. The latest reply (${ago(mr.observedAt)}) came from <b>${esc(mr.observed)}</b>.${mr.restartNeeded ? ' The session was started with an older configuration.' : d.running ? ' The model may have been switched inside the session, or a lead spawned this agent with another model.' : ''}</div>
      ${d.running ? `<button class="small" data-act="restart" data-agent="${d.id}">Restart with ${esc(mr.configured)}</button>` : '<div class="note">The next start uses the configured model.</div>'}</div>`
    : mr.restartNeeded ? `<div class="att stall" style="margin-top:10px"><div class="where">Restart to apply</div><div class="q">This session started with ${esc(mr.startedWith)}; the agent is now configured for ${esc(mr.configured)} (${esc(e.effort)} effort).</div>
      <button class="small" data-act="restart" data-agent="${d.id}">Restart</button></div>` : '';
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis" style="font-size:18px">${esc(d.displayName)}</h2>
      <div class="note">${esc(e.title || '')} · model ${esc(mr.configured || '?')}${mr.observed ? ` · last reply from <span class="${mr.mismatch ? 'warnText' : ''}">${esc(mr.observed)}</span>` : ''}</div>
      <div class="note"><i class="dot ${d.standby ? 'standby' : d.state}"></i> ${esc(deskState(d))}</div></div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">${startButtons(d)}
      <a class="chip" style="justify-content:center" href="#/floor/${floor.id}/desk/${d.id}${routeScreen ? '' : '/screen'}">${routeScreen ? 'Leave screen' : 'Look at screen'}</a></div></div>`;
  const crashed = d.crash && !d.crash.withLead;
  const crash = crashed ? `<div class="att crash" style="margin-top:10px"><div class="where">Stopped unexpectedly</div><div class="q">${esc(d.crash.text)}</div>
      <div class="note">${d.resume ? `Resume continues session <code>${esc(d.resume.sessionId.slice(0, 8))}</code> with its context${d.lead || d.kindOf === 'lead' ? '; the lead is told its teammates died and re-spawns only what is still needed' : ''}. Start fresh begins a new session.` : 'No previous session was found; start it fresh.'}</div>
${d.resume ? '' : `<div class="row" style="margin-top:8px"><button class="small" data-act="start" data-agent="${d.id}">Start fresh</button></div>`}</div>`
    : d.crash?.withLead ? `<div class="att stall" style="margin-top:10px"><div class="where">Stopped with the lead</div><div class="q">${esc(d.stopNote || d.crash.text)}</div><div class="note">This teammate ran inside the lead's session. Resume the lead; it re-spawns the teammates whose work is still open.</div></div>` : '';
  const update = ts.updateAvailable ? `<div class="att stall" style="margin-top:10px"><div class="where">Update available</div><div class="q">${esc(e.title)} template v${d.agent.role.version} → v${ts.latestVersion}</div>
      <div class="row wrap"><button class="small" data-act="tpl-diff" data-agent="${d.id}">View diff</button><button class="small gold" data-act="tpl-update" data-agent="${d.id}">Update</button><button class="small" data-act="tpl-keep" data-agent="${d.id}">Keep current</button></div></div>` : '';
  const overview = `${head}${crash}${modelWarn}${update}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <div class="section"><div class="sectionHead"><h3 class="grow">Send task</h3></div><div data-slot="task"></div>
      ${d.pending ? `<div class="note">Queued: ${esc(d.pending.slice(0, 120))}</div>` : ''}
      ${d.work ? `<div class="note" style="margin-top:6px">Current work (${d.work.doneAt ? `done ${ago(d.work.doneAt)}` : `since ${ago(d.work.assignedAt)}`}): ${esc(d.work.text.slice(0, 160))} <button class="small ghost" data-act="work-done" data-agent="${d.id}">Clear</button></div>` : ''}</div>
    <div class="section note">Terminal: <code>${esc(d.attach)}</code> <button class="small ghost" data-act="copy" data-text="${esc(d.attach)}">Copy</button></div>`;
  const screen = d.running ? `<pre class="screen" data-scroll="screen">${esc(d.screen) || ' '}</pre>` : `<div class="empty">The agent is stopped. ${d.resume ? 'Resume or start it' : 'Start it'} to see its live screen.</div>`;
  const events = d.events.length ? `<ul class="feed events">${d.events.map((ev) => `<li><span class="k ${ev.kind}"></span><div class="grow"><div><b>${esc(ev.title)}</b>${ev.tool ? ` <span class="note">${esc(ev.tool)}</span>` : ''}</div><div class="d ${ev.kind === 'think' || ev.kind === 'task' ? '' : 'mono'}">${esc(ev.detail)}</div><div class="t">${ago(ev.ts)}</div></div></li>`).join('')}</ul>` : '<div class="empty">No transcript yet.</div>';
  const pills = (list, cls = '') => list.map((s) => `<span class="pill ${cls}">${esc(s)}</span>`).join('');
  const profile = `<dl class="kv">
      <dt>Agent id</dt><dd><code>${esc(d.id)}</code></dd>
      <dt>Role</dt><dd>${esc(e.title)} ${d.agent.role.detached ? '<span class="badge">detached copy</span>' : `<span class="badge">${esc(d.agent.role.template)}@${d.agent.role.version}</span>`}${ts.keptVersion ? ` <span class="note">kept (v${ts.keptVersion} available)</span>` : ''}</dd>
      <dt>Model (configured)</dt><dd>${esc(e.model)}${o.model ? ' <span class="note">(override)</span>' : ''}${mr.startedWith ? ` <span class="note">· session started with ${esc(mr.startedWith)}</span>` : ''}</dd>
      <dt>Model (observed)</dt><dd>${mr.observed ? `<span class="${mr.mismatch ? 'warnText' : ''}">${esc(mr.observed)}</span> <span class="note">${ago(mr.observedAt)}${mr.mismatch ? ' · differs from the configured model' : ''}</span>` : '<span class="note">no replies yet</span>'}</dd>
      <dt>Effort</dt><dd>${esc(e.effort)}${o.effort ? ' <span class="note">(override)</span>' : ''}</dd>
      <dt>Skills</dt><dd>${skillsHtml(d)}${pills(o.skills?.remove || [], 'rm')}${(e.skills || []).length || (o.skills?.remove || []).length ? '' : '<span class="note">none</span>'}</dd>
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
    { id: 'desk', title: 'Desk', card: 'main', count: dialog.length || undefined, countClass: 'bad', html: overview },
    { id: 'screen', title: 'Screen', card: 'main', html: screen },
    { id: 'transcript', title: 'Transcript', card: 'main', html: events },
    { id: 'profile', title: 'Profile', card: 'main', html: profile },
  ];
}
