// Panel content for the three places: Lobby, Floor, Desk. Each view returns sections
// { id, title, card: top | main | tabs, html, head?, count? }; app.js lays them out as floating cards in the right
// panel (desktop) or as tabs of the bottom sheet (phone).
import { esc, money, ago, avatar, STATE_TEXT, stateText, drafts, mdLite } from './lib.js';
import { t as tt, tx } from './i18n.js';

const KIND_TEXT = { question: tt('Question'), permission: tt('Permission'), reply: tt('Waiting for your reply'), stall: tt('Stalled'), budget: tt('Budget'), resource: tt('Resources'), merge: tt('Merge'), crash: tt('Stopped unexpectedly'), decided: tt('Decided by autopilot'), finished: tt('Finished'), taskdone: tt('Command ended'), scope: tt('Scope change'), design: tt('Pick a design') };
// cards whose text the server writes (translated); questions, replies and reports are the agent's own words
const SYSTEM_KINDS = new Set(['stall', 'budget', 'resource', 'merge', 'crash', 'scope']);

// ---------- Attention ----------
// ---------- long-running commands (server/tasks.js) ----------
// "7m 32s", "1h 04m", "45s"
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}
const taskElapsed = (t) => Math.max(t.elapsedMs || 0, Date.now() - t.startedAt);
// "e2e Playwright · 7m 32s"
export const taskLine = (t) => tt('{label} · {time}', { label: t.label, time: dur(taskElapsed(t)) });
const resultText = (tk) => (tk.passed != null ? (tk.failed ? tt('{passed} passed, {failed} failed', tk) : tt('{passed} passed', tk)) : '');
// "e2e Playwright failed in 8m 00s: 40 passed, 2 failed"
export function taskDoneText(tk) {
  const r = resultText(tk), time = dur(tk.ms);
  if (tk.status === 'killed') return tt('{label} was stopped after {time}', { label: tk.label, time });
  const failed = tk.status === 'failed' || tk.ok === false;
  return r ? (failed ? tt('{label} failed in {time}: {result}', { label: tk.label, time, result: r }) : tt('{label} finished in {time}: {result}', { label: tk.label, time, result: r }))
    : (failed ? tt('{label} failed in {time}', { label: tk.label, time }) : tt('{label} finished in {time}', { label: tk.label, time }));
}
// the Desk's card for a running command: label, time, progress, its last output lines, a stall
function taskHtml(t) {
  const p = t.progress;
  const stall = t.stall === 'quiet' ? tt('No output for {n} min: it may hang.', { n: Math.round((Date.now() - t.lastOutputAt) / 60000) })
    : t.stall === 'long' ? tt('Running far longer than usual ({typical}).', { typical: dur(t.typicalMs) }) : '';
  return `<div class="att task${t.stall ? ' stall' : ''}" style="margin-top:10px"><div class="where"><span class="grow">${tt('Running')} · ${esc(taskLine(t))}</span>${t.background ? `<span class="note">${tt('in the background')}</span>` : ''}</div>
    ${p ? `<div class="taskBar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p.pct}%"></i></div><div class="note">${p.total ? tt('{done} of {total}', p) : `${p.pct} %`}</div>` : ''}
    ${t.lines?.length ? `<pre class="taskOut">${esc(t.lines.join('\n'))}</pre>` : `<div class="note">${tt('No output yet.')}</div>`}
    ${stall ? `<div class="note warnText">${stall}</div>` : ''}<div class="note"><code>${esc(t.command)}</code></div></div>`;
}

export function attentionHtml(items, { showFloor = true, onDesk = false } = {}) {
  if (!items.length) return `<div class="empty">${tt('All clear. Nothing is waiting for you.')}</div>`;
  return items.map((a) => {
    const where = [a.kind === 'finished' ? tt('{name} finished', { name: esc(String(a.agentName || tt('The agent')).split(' - ')[0]) }) : KIND_TEXT[a.kind] || a.kind, showFloor && a.floorNumber ? tt('Floor {n} · {name}', { n: a.floorNumber, name: esc(a.floorName) }) : '', a.agentName ? esc(a.agentName) : ''].filter(Boolean).join(' · ');
    let body = '';
    if (a.kind === 'reply') {
      const who = esc(String(a.agentName || tt('the agent')).split(' - ')[0]);
      body = `<form class="replyForm" data-act="reply" data-id="${a.id}"><textarea name="text" rows="3" data-draft="${a.id}" placeholder="${tt('Reply to {name}…', { name: who })}" aria-label="${tt('Your reply to {name}', { name: who })}" required>${esc(drafts.get(a.id) || '')}</textarea>
        <div class="row"><span class="note grow">${tt('Sent to {name} as the next task.', { name: who })}</span><button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}" title="${tt('Hide this until the agent asks again')}">${tt('Dismiss')}</button><button class="small gold">${tt('Send reply')}</button></div></form>`;
    } else if (a.kind === 'finished') {
      // a calm card: the agent's report, then Reply (its next task), OK and Open desk
      const who = esc(String(a.agentName || tt('the agent')).split(' - ')[0]);
      body = a.canReply === false
        ? `<div class="row" style="margin-top:6px"><span class="note grow">${a.asks ? tt('It asks you something. This agent runs on its own: reply in its own terminal.') : tt('This agent runs on its own: reply in its own terminal.')}</span><button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('OK')}</button></div>`
        : `<form class="replyForm" data-act="reply" data-id="${a.id}"><textarea name="text" rows="2" data-draft="${a.id}" placeholder="${tt('Reply to {name} (optional)…', { name: who })}" aria-label="${tt('Your reply to {name}', { name: who })}" required>${esc(drafts.get(a.id) || '')}</textarea>
        <div class="row"><span class="note grow">${tt('A reply goes to {name} as the next task.', { name: who })}</span><button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}" title="${tt('Read it; hide the card')}">${tt('OK')}</button><button class="small">${tt('Reply')}</button></div></form>`;
    } else if (a.kind === 'taskdone') {
      // a calm card: the command's duration and result; OK, or the agent's log (its desk)
      body = `<div class="row" style="margin-top:6px"><span class="grow"></span>${a.floorId && a.agentId ? `<a class="chip" href="#/floor/${a.floorId}/desk/${a.agentId}">${tt('Open log')}</a>` : ''}<button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('OK')}</button></div>`;
    } else if (a.kind === 'design') {
      body = `<div class="row" style="margin-top:6px"><span class="grow"></span><button class="small gold" data-act="designs" data-screen="${esc(a.screen)}">${tt('See the variants')}</button></div>`;
    } else if (a.kind === 'decided') {
      // a muted card: what Autopilot chose, the other options to change it, OK to keep it
      body = `<div class="note">${tt('Decided automatically: <b>{choice}</b>', { choice: esc(a.chosen) })}</div>
        <div class="row wrap" style="margin-top:8px">${a.options.length ? `<span class="note">${tt('Change answer:')}</span>${a.options.map((o) => `<button class="small" data-act="answer" data-id="${a.id}" data-n="${o.n}">${esc(o.label)}</button>`).join('')}` : ''}
        <span class="spacer"></span><button class="small ghost" data-act="dismiss" data-id="${a.id}" title="${tt('Keep this decision')}">${tt('OK')}</button></div>`;
    } else if (a.kind === 'crash') {
      // Resume continues the agent's last session (the default after a crash); Start fresh loses its context
      body = `<div class="row wrap">${a.options.map((o) => `<button class="small ${o.n === 1 ? 'gold' : 'ghost'}" data-act="crash-answer" data-id="${a.id}" data-n="${o.n}">${o.n === 1 ? tt('Resume') : tt('Start fresh')}</button>`).join('')}
        <button class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('Dismiss')}</button></div>${a.resumable ? `<div class="note" style="margin-top:6px">${tt('Resume continues the last session with its context. Start fresh begins a new session.')}</div>` : ''}`;
    } else if (a.answerable && a.options?.length) {
      body = `<div class="opts">${a.options.map((o) => o.free
        ? `<form class="free" data-act="answer-free" data-id="${a.id}" data-n="${o.n}"><input name="text" placeholder="${esc(o.label)}" aria-label="${tt('Your answer')}" required><button class="gold">${tt('Send')}</button></form>`
        : `<button data-act="answer" data-id="${a.id}" data-n="${o.n}">${o.n}. ${esc(o.label)}</button>`).join('')}</div>`;
    } else if (a.kind === 'permission' && a.live) {
      body = `<div class="note">${a.agentId ? tt("Reported live by Claude Code. Answer it on the Desk (Screen tab) or in the agent's terminal.") : tt('Reported live by Claude Code.')}</div>`;
    } else if (a.kind === 'question') {
      body = `${a.options?.length ? `<ol class="note">${a.options.map((o) => `<li>${esc(o.label)}</li>`).join('')}</ol>` : ''}<div class="note">${tt("Answer it in the agent's terminal (not started from The AI Squad).")}</div>`;
    }
    const links = [];
    if (a.floorId && a.agentId && !onDesk) links.push(`<a href="#/floor/${a.floorId}/desk/${a.agentId}">${tt('Open desk')}</a>`);
    else if (a.floorId) links.push(`<a href="#/floor/${a.floorId}">${tt('Open Floor')}</a>`);
    if (a.kind === 'stall' || a.kind === 'merge') links.push(`<button class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('Dismiss')}</button>`);
    body = apNote(a) + body;
    // a click on the message opens it large (the conversation view)
    const text = a.kind === 'reply' || a.kind === 'finished' ? `<div class="replyMsg md" data-act="convo" data-id="${a.id}" data-scroll="reply-${a.id}"${a.kind === 'finished' ? ' data-top' : ''} tabindex="0" title="${tt('Open large')}" aria-label="${tt('Message from {name}, open large', { name: esc(a.agentName || tt('the agent')) })}">${mdLite(a.text)}</div>` : `<div class="q" data-act="convo" data-id="${a.id}" title="${tt('Open large')}">${esc(a.kind === 'taskdone' && a.task ? taskDoneText(a.task) : SYSTEM_KINDS.has(a.kind) ? tx(a.text) : a.text)}</div>`;
    return `<div class="att ${a.kind} ${a.level || ''}${a.muted ? ' muted' : ''}" data-item-floor="${esc(a.floorId || '')}" data-item-agent="${esc(a.agentId || '')}" data-item-kind="${esc(a.kind)}"><div class="where"><span class="grow">${where} · ${ago(a.ts)}</span><button type="button" class="openBig" data-act="convo" data-id="${a.id}" aria-label="${tt('Open large')}" title="${tt('Open large')}">⤢</button></div>${text}${body}${links.length ? `<div class="row" style="margin-top:8px">${links.join(' ')}</div>` : ''}</div>`;
  }).join('');
}

// what Autopilot does with an item: critical ones wait for the owner; others are answered or nudged after the timeout
function apNote(a) {
  const ap = a.autopilot;
  if (!ap) return '';
  if (ap.critical) return `<div class="apNote crit">${ap.reasons?.length && ap.reasons[0] !== 'unclear' ? tt('Critical ({reasons}): Autopilot leaves this to you.', { reasons: esc(ap.reasons.map((r) => tx(r.replace(/-/g, ' '))).join(', ')) }) : tt('Critical: Autopilot leaves this to you.')}</div>`;
  if (!ap.auto) return '';
  const min = Math.max(0, Math.ceil((ap.autoAt - Date.now()) / 60e3));
  const choice = esc(String(a.options.find((o) => o.n === ap.recommended)?.label || '').replace(/\s*\(recommended\)\s*/i, ''));
  const text = a.kind === 'question'
    ? (min ? tt('Autopilot answers "{choice}" in {min} min if you do not.', { choice, min }) : tt('Autopilot answers "{choice}" now if you do not.', { choice }))
    : (min ? tt('Autopilot asks the agent to decide in {min} min if you do not.', { min }) : tt('Autopilot asks the agent to decide now if you do not.'));
  return `<div class="apNote">${text}</div>`;
}
export const needsYou = (list) => (list || []).filter((a) => !a.muted);

// ---------- Lobby ----------
// one row per Floor: number badge in the Floor's colour, name, one status line, the lamp
function floorRow(f) {
  if (f.missing) return `<div class="frow missing"><span class="fnum" style="--c:#9ca3af">${f.number}</span><span class="grow"><b>${esc(f.name)}</b><span class="sub">${esc(tx(f.error))}</span></span>
    <button class="small ghost danger" data-act="remove-floor" data-floor="${f.id}">${tt('Remove')}</button></div>`;
  const c = f.counts || {}, n = f.agents.length;
  const line = f.independent
    ? `${n === 1 ? tt('{n} agent on their own', { n }) : tt('{n} agents on their own', { n })}${f.agents.some((a) => a.running) ? ` · ${tt('{n} live', { n: f.agents.filter((a) => a.running).length })}` : ''}`
    : `${n === 1 ? tt('{n} agent', { n }) : tt('{n} agents', { n })}${c.working ? ` · ${tt('{n} working', { n: c.working })}` : ''}${f.workflow === 'squad-sprint' ? ' · Squad Sprint' : ''} · ${tt('today {cost}', { cost: money(f.cost.today) })}`;
  const flag = c.waiting ? `<span class="st waiting">${c.waiting === 1 ? tt('{n} needs you', { n: c.waiting }) : tt('{n} need you', { n: c.waiting })}</span>` : f.budget?.level === 'over' ? `<span class="st waiting">${tt('budget')}</span>` : f.budget?.level === 'warn' ? `<span class="st idle">${tt('budget')}</span>` : '';
  return `<a class="frow" href="#/floor/${f.id}"><span class="fnum" style="--c:${esc(f.accent)}">${f.number}</span><span class="grow"><b>${esc(f.name)}</b><span class="sub">${esc(line)}</span></span>${flag}<span class="lamp ${f.lamp}" title="${esc(tx(f.lamp))}"></span></a>`;
}

export function lobbySections(b) {
  const floors = [...b.floors].sort((x, y) => y.number - x.number);
  const detected = b.detected.map((p, i) => `<div class="frow"><span class="grow"><b>${esc(p.name)}</b><span class="sub" title="${esc(p.root)}">${p.sessions === 1 ? tt('{n} session', { n: p.sessions }) : tt('{n} sessions', { n: p.sessions })} · ${tt('active {ago}', { ago: ago(p.lastActive) })}${p.team ? ` · ${tt('team {name}', { name: esc(p.team) })}` : ''}</span></span>
      ${p.hasFloorConfig ? `<button class="small" data-act="adopt" data-i="${i}">${tt('Register')}</button>` : `<button class="small" data-act="from-detected" data-i="${i}">${tt('Create Floor')}</button>`}</div>`).join('');
  const out = [
    { id: 'floors', title: tt('Floors'), card: 'main', count: b.floors.length, html: `
      <button class="setupBtn" data-act="setup-squad"><svg><use href="#i-spark"/></svg><span><b>${tt('Set up Squad')}</b><small>${tt('Describe what you want to build; get a team and how it works together')}</small></span></button>
      ${b.autopilotToday ? `<p class="note apDigest">${tt('Decided by autopilot today: <b>{n}</b>', { n: b.autopilotToday })} <span class="note">${tt("(see each Floor's Squad Log)")}</span></p>` : ''}
      <div class="list">${floors.map(floorRow).join('') || `<div class="empty">${tt('No Floors yet.')}</div>`}</div>
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="small ghost" data-act="new-floor" title="${tt('A Floor without a Blueprint, set up by hand')}">${tt('+ New Floor by hand')}</button></div>` },
    { id: 'detected', title: tt('Detected'), card: 'main', count: b.detected.length, html: `
      <p class="note" style="margin-top:0">${tt('Directories with Claude Code activity that are not Floors yet.')}</p>
      <div class="list">${detected || `<div class="empty">${tt('Nothing new detected.')}</div>`}</div>` },
  ];
  if (b.attention.length) out.unshift({ id: 'attention', title: tt('Needs you'), card: 'top', count: needsYou(b.attention).length || undefined, countClass: 'bad', html: attentionHtml(b.attention) });
  return out;
}

// ---------- Floor ----------
const ROLE_SHORT = (a) => [a.lead ? tt('Lead') : '', a.title, a.model].filter(Boolean).join(' · ');
const STATE_SHORT = { working: tt('working'), waiting: tt('needs you'), idle: tt('idle'), stopped: tt('stopped') };
// one row per agent: colour dot, name, role, one status chip, what it is doing
export function agentRow(floorId, a, selected) {
  const act = a.standby ? tx(a.activity) : a.crash && !a.crash.withLead ? tx(a.crash.text) : a.stopNote ? `${tx(a.stopNote)}${a.lastTs ? ` · ${ago(a.lastTs)}` : ''}`
    : a.state === 'stopped' ? (a.independent ? tx(a.activity) || tt('not running') : a.lastTs ? tt('stopped · last seen {ago}', { ago: ago(a.lastTs) }) : tt('stopped'))
    : a.task ? taskLine(a.task)
    : a.state === 'idle' ? (a.lastTs ? tt('idle {ago}', { ago: ago(a.lastTs).replace(' ago', '') }) : tt('idle')) : tx(a.activity) || STATE_TEXT[a.state];
  // a running command: its last output lines as the tooltip, the row marked while it stalls
  const tip = a.task?.lines?.length ? ` title="${esc(a.task.lines.join('\n'))}"` : '';
  return `<div class="arow${selected ? ' sel' : ''}${a.task?.stall ? ' taskStall' : ''}" data-href="#/floor/${floorId}/desk/${a.id}" role="button" tabindex="0"${tip}>
    <i class="adot" style="--c:${esc(a.appearance?.shirt || '#3d82d6')}"></i>
    <span class="grow"><span class="nm"><b>${esc(String(a.displayName).split(' - ')[0])}</b> <span class="role">${esc(ROLE_SHORT(a))}</span></span><span class="act">${esc(act)}</span></span>
    ${a.standby ? `<span class="st standby">${tt('not started')}</span>` : a.crash && !a.crash.withLead ? `<span class="st crashed">${tt('crashed')}</span>` : `<span class="st ${a.state}">${STATE_SHORT[a.state]}</span>`}</div>`;
}

function feedHtml(feed) {
  if (!feed.length) return `<div class="empty">${tt('No activity yet. Start an agent and give it a task.')}</div>`;
  const hm = (ts) => new Date(ts).toTimeString().slice(0, 5);
  return `<ul class="feed">${feed.map((e) => `<li title="${esc(e.detail || '')}"><span class="t">${hm(e.ts)}</span><span class="k ${e.kind}"></span><span class="grow ellipsis"><b>${esc(String(e.agentName).split(' - ')[0])}</b> ${esc(tx(e.title))}${e.detail && e.kind !== 'think' ? ` <span class="d">· ${esc(e.detail.split('\n')[0])}</span>` : ''}</span></li>`).join('')}</ul>`;
}

function messagesHtml(msgs, team) {
  if (!msgs.length) return `<div class="empty">${tt('No messages between agents yet.')}</div>`;
  const name = (id) => String(team.find((a) => a.id === id)?.displayName || id).split(' - ')[0];
  return `<ul class="feed msgs">${msgs.map((m) => `<li><span class="t">${new Date(m.ts).toTimeString().slice(0, 5)}</span><span class="k talk"></span><span class="grow"><b>${esc(String(m.fromName).split(' - ')[0])}</b> → <b>${esc(name(m.to))}</b> <span class="d">${esc(m.text)}</span></span></li>`).join('')}</ul>`;
}

const COLUMN_TEXT = { TODO: tt('To do'), IN_PROGRESS: tt('In progress'), REVIEW: tt('Review'), BLOCKED: tt('Blocked / bugs'), DONE: tt('Done') };
const COLUMN_COLOR = { TODO: '#9ca3af', IN_PROGRESS: '#2563eb', REVIEW: '#7c3aed', BLOCKED: '#dc2626', DONE: '#16a34a' };
export function boardHtml(f) {
  const b = f.board;
  if (!b || !b.pack) return `<div class="empty">${tt('The Squad Sprint pack is not set up on this Floor yet. Save the Floor settings with the Squad Sprint workflow to scaffold it.')}</div>`;
  const name = (id) => String(f.agents.find((a) => a.id === id)?.displayName || id).split(' - ')[0];
  const cols = Object.keys(COLUMN_TEXT).map((c) => {
    const items = b.tasks.filter((t) => t.column === c);
    return `<div class="kcol"><h4><i style="background:${COLUMN_COLOR[c]}"></i>${COLUMN_TEXT[c]}<span class="c">${items.length}</span></h4>${items.map((t) => `<div class="kcard" style="border-top-color:${COLUMN_COLOR[c]}"><b>${esc(t.task)}</b>
      <div class="note">${esc(name(t.owner))}${t.blockedBy ? ` · ${tt('after {task}', { task: esc(t.blockedBy) })}` : ''}${t.status && t.status.toUpperCase() !== c ? ` · ${esc(t.status)}` : ''}</div></div>`).join('') || `<div class="empty">${tt('Empty')}</div>`}</div>`;
  }).join('');
  return `<div class="chips" style="margin-top:0">${b.sprint ? `<span class="chip info">${tt('Sprint {name}', { name: esc(b.sprint) })}</span>` : ''}<span class="chip">${tt('{n} tasks', { n: b.tasks.length })}</span>
      ${b.bugs.open.length ? `<span class="chip bad">${b.bugs.open.length === 1 ? tt('{n} open bug', { n: 1 }) : tt('{n} open bugs', { n: b.bugs.open.length })}</span>` : ''}${b.bugs.fixed.length ? `<span class="chip warn">${tt('{n} to retest', { n: b.bugs.fixed.length })}</span>` : ''}
      ${b.sprint ? `<span class="chip ok">${tt('{n} QA pass', { n: b.qa.pass.length })}</span>` : ''}${b.questions ? `<span class="chip">${tt('{n} questions', { n: b.questions })}</span>` : ''}
      <span class="note">${tt('From <code>{file}</code>; the lead keeps it current.', { file: esc(b.source || 'docs/squad/TASKS.md') })}</span></div>
    ${b.tasks.length ? `<div class="kcols">${cols}</div>` : `<div class="empty">${tt('No tasks yet. Start the lead and run <code>/sprint</code> to plan the sprint.')}</div>`}`;
}

// the daily standup (from the Squad Log): per agent done, doing, blocked by; "Now" asks the server for today so far
export function standupHtml(s, meeting = null) {
  const now = meeting ? `<div class="chip info" style="margin-bottom:8px">${tt('At the table now: {label} ({n} agents)', { label: esc(tx(meeting.label)), n: meeting.agents.length })}</div>` : '';
  if (!s) return `${now}<div class="empty">${tt('No standup yet. It runs every day at the time in Floor settings, from the Squad Log.')}</div><button class="small" data-act="standup-now">${tt('Standup so far today')}</button>`;
  return `${now}<div class="row" style="margin-bottom:6px"><b class="grow">${tt('Standup {when}', { when: esc(new Date(s.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })) })}</b><button class="small ghost" data-act="standup-now">${tt('So far today')}</button></div>
    ${standupAgents(s)}`;
}
export function standupAgents(s) {
  const list = (xs, cls) => (xs.length ? `<ul class="suList ${cls}">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="note">–</span>');
  return s.quiet ? `<div class="empty">${tt('A quiet day: nothing done, in progress or blocked.')}</div>` : s.agents.filter((a) => a.done.length || a.doing.length || a.blocked.length).map((a) => `<div class="suAgent"><b>${esc(a.name)}</b>
    <div class="suGrid"><span class="note">${tt('Done')}</span>${list(a.done, 'done')}<span class="note">${tt('Doing')}</span>${list(a.doing, 'doing')}<span class="note">${tt('Blocked by')}</span>${list(a.blocked, 'blocked')}</div></div>`).join('');
}

// the Blueprint this squad follows and the state of its source documents
const DOC_STATE = { approved: ['ok', tt('approved')], draft: ['warn', tt('draft')], missing: ['bad', tt('missing')] };
function standardHtml(bp) {
  const pending = bp.sourceDocs.filter((d) => d.status !== 'approved').length;
  return `<div class="row" style="margin-bottom:8px"><b class="grow">${esc(bp.title)} v${bp.version}</b>${pending ? `<span class="st idle">${tt('{n} not approved', { n: pending })}</span>` : `<span class="st working">${tt('all approved')}</span>`}</div>
    ${bp.latest > bp.version ? `<div class="row" style="margin-bottom:8px"><span class="chip info grow">${tt('Blueprint v{version} available', { version: bp.latest })}</span><button class="small" data-act="blueprint-update">${tt('Update')}</button></div>` : ''}
    <p class="note" style="margin-top:0">${pending ? tt("Roles, channels, gates and the definition of done are in <code>AISQUAD.md</code> and in every agent's prompt. The lead collects the source documents from you first.") : tt("Roles, channels, gates and the definition of done are in <code>AISQUAD.md</code> and in every agent's prompt.")}</p>
    ${bp.sourceDocs.map((d) => `<div class="docRow"><span class="grow"><code>${esc(d.path)}</code><span class="note">${esc(d.purpose)}</span></span><span class="chip ${DOC_STATE[d.status][0]}">${DOC_STATE[d.status][1]}</span></div>`).join('')}
    <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="small ${pending ? 'gold' : ''}" data-act="source-docs">${pending ? tt('Review and approve') : tt('Open source documents')}</button></div>`;
}

// the Autopilot level also sits here (on a phone the top bar has no room for its chip)
const AP_LEVEL = { off: tt('off'), balanced: tt('balanced'), full: tt('full') };
const apMini = (f) => (f.autopilot && !f.independent ? `<button class="chip apMini ${f.autopilot.level}${f.autopilot.critical ? ' crit' : ''}" data-act="floor-settings" title="${tt('Autopilot level (Floor settings)')}">${tt('Autopilot: {level}', { level: AP_LEVEL[f.autopilot.level] || f.autopilot.level })}${f.autopilot.critical ? ` · ${tt('{n} critical', { n: f.autopilot.critical })}` : ''}</button>` : '');
const agentsHead = (f, extra = '') => `<div class="cardHead"><h3>${tt('Agents')}</h3>${apMini(f)}<span class="meta">${tt('{n}/{total} active', { n: f.agents.filter((a) => a.state === 'working' || a.state === 'waiting').length, total: f.agents.length })}</span>${extra}</div>`;

function independentFloorSections(f, deskAgentId) {
  const sections = [
    { id: 'agents', title: tt('Agents'), card: 'main', head: agentsHead(f, `<button class="small ghost" data-act="rescan" title="${tt('Look for agents again')}">${tt('Rescan')}</button>`), count: f.agents.length,
      html: `<div class="list">${f.agents.map((a) => agentRow(f.id, a, a.id === deskAgentId)).join('') || `<div class="empty">${tt('No independent agents right now. Agents you run yourself in a terminal, tmux or VS Code show up here.')}</div>`}</div>
      <p class="note">${tt('Claude Code agents already running on this machine (processes, tmux panes, recent transcripts). The AI Squad only watches them; open one and <b>Adopt</b> it into a squad.')}</p>` },
    { id: 'activity', title: tt('Activity'), icon: 'activity', card: 'tabs', html: feedHtml(f.feed || []) },
  ];
  const att = f.attentionItems || [];
  if (att.length) sections.unshift({ id: 'f-attention', title: tt('Needs you'), card: 'top', count: needsYou(att).length || undefined, countClass: 'bad', html: attentionHtml(att, { showFloor: false }) });
  return sections;
}

export function floorSections(f, deskAgentId = null) {
  if (f.independent) return independentFloorSections(f, deskAgentId);
  if (f.missing) return [{ id: 'agents', title: tt('Floor'), card: 'main', html: `<div class="empty">${esc(tx(f.error))}: <code>${esc(f.path)}</code></div><button class="danger" data-act="remove-floor" data-floor="${f.id}">${tt('Remove this Floor')}</button>` }];
  const sections = [
    { id: 'agents', title: tt('Agents'), card: 'main', head: agentsHead(f), count: f.agents.length,
      html: `<div class="list">${f.agents.map((a) => agentRow(f.id, a, a.id === deskAgentId)).join('') || `<div class="empty">${tt('No agents yet.')} <button class="small gold" data-act="add-agent">${tt('Add an agent')}</button></div>`}</div>` },
    { id: 'activity', title: tt('Activity'), icon: 'activity', card: 'tabs', html: feedHtml(f.feed || []) },
    { id: 'messages', title: tt('Messages'), icon: 'chat', card: 'tabs', count: (f.messages || []).length, html: messagesHtml(f.messages || [], f.agents) },
  ];
  if (f.blueprint) sections.push({ id: 'standard', title: tt('Standard'), icon: 'doc', card: 'tabs', html: standardHtml(f.blueprint) });
  sections.push({ id: 'standup', title: tt('Standup'), icon: 'activity', card: 'tabs', html: standupHtml(f.standup, f.meeting) });
  const att = f.attentionItems || [];
  if (att.length) sections.unshift({ id: 'f-attention', title: tt('Needs you'), card: 'top', count: needsYou(att).length || undefined, countClass: 'bad', html: attentionHtml(att, { showFloor: false }) });
  return sections;
}

// ---------- Desk ----------
// the status line under the agent's name: state, then what it is doing (a standby text says it all)
const deskState = (d) => (d.standby ? tx(d.activity).replace(/^./, (c) => c.toUpperCase())
  : d.crash && !d.crash.withLead ? tx(d.crash.text) : d.stopNote ? tx(d.stopNote).replace(/^./, (c) => c.toUpperCase())
  : `${stateText(d)}${d.activity && d.state !== 'stopped' && !d.waitingReply ? ` · ${tx(d.activity)}` : ''}`);
const SKILL_STATE = { project: ['ok', tt('in project')], user: ['ok', tt('in user skills')], bundled: ['info', tt('from plugin')], missing: ['warn', tt('not installed')] };
function skillsHtml(d) {
  const list = d.skills || [];
  if (!list.length) return '';
  const added = new Set(d.agent?.overrides?.skills?.add || []);
  const installable = list.filter((s) => s.installable).map((s) => s.name);
  return `<div class="skillList">${list.map((s) => `<div class="skillRow" title="${esc(s.description)}"><span class="pill ${added.has(s.name) ? 'add' : ''}">${esc(s.name)}</span>
      <span class="chip ${SKILL_STATE[s.status][0]}">${SKILL_STATE[s.status][1]}</span>${s.installable ? `<button class="small ghost" data-act="install-skill" data-skill="${esc(s.name)}" title="${tt('Copy the bundled skill into .claude/skills of this project')}">${tt('Install')}</button>` : ''}</div>`).join('')}</div>
    ${installable.length > 1 ? `<button class="small" data-act="install-skill" data-skill="${esc(installable.join(','))}">${tt('Install all {n} into the project', { n: installable.length })}</button>` : ''}
    <div class="note">${tt('Plugin skills work in sessions The AI Squad starts; installing copies them into <code>.claude/skills/</code> so every session of this project has them.')}</div>`;
}
function independentDeskSections(floor, d, routeScreen) {
  const dialog = (floor.attentionItems || []).filter((a) => a.agentId === d.id && (d.dialog || a.kind === 'reply' || a.kind === 'finished'));
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis" style="font-size:18px">${esc(d.displayName)}</h2>
      <div class="note">${esc(d.title)}${d.models?.observed ? ` · ${tt('last reply from {model}', { model: esc(d.models.observed) })}` : ''}</div>
      <div class="note"><i class="dot ${d.standby ? 'standby' : d.state}"></i> ${esc(deskState(d))}</div></div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px"><button class="gold" data-act="adopt-agent" data-agent="${d.id}">${tt('Adopt into a squad')}</button>
      <a class="chip" style="justify-content:center" href="#/floor/${floor.id}/desk/${d.id}${routeScreen ? '' : '/screen'}">${routeScreen ? tt('Leave screen') : tt('Look at screen')}</a></div></div>`;
  const overview = `${head}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <dl class="kv" style="margin-top:12px"><dt>${tt('Directory')}</dt><dd><code>${esc(d.root)}</code></dd><dt>${tt('Runs in')}</dt><dd>${esc(d.via)}${d.pid ? ` <span class="note">pid ${d.pid}</span>` : ''}</dd><dt>${tt('Cost today')}</dt><dd>${money(d.costToday)}</dd></dl>
    <p class="note">${tt('An independent agent: The AI Squad shows its status, screen, transcript and questions, but does not start, stop or give it tasks. Adopt it to make it a member of a squad.')}</p>
    ${d.attach ? `<div class="section note">${tt('Terminal:')} <code>${esc(d.attach)}</code> <button class="small ghost" data-act="copy" data-text="${esc(d.attach)}">${tt('Copy')}</button></div>` : ''}`;
  const screen = d.screen ? `<pre class="screen" data-scroll="screen">${esc(d.screen)}</pre>` : `<div class="empty">${d.running ? tt('This agent does not run in tmux, so its screen cannot be shown. Its transcript is in the Transcript tab.') : tt('No Claude Code process is running for this agent.')}</div>`;
  const events = d.events.length ? `<ul class="feed events">${d.events.map((ev) => `<li><span class="k ${ev.kind}"></span><div class="grow"><div><b>${esc(tx(ev.title))}</b>${ev.tool ? ` <span class="note">${esc(ev.tool)}</span>` : ''}</div><div class="d ${ev.kind === 'think' || ev.kind === 'task' ? '' : 'mono'}">${esc(ev.detail)}</div><div class="t">${ago(ev.ts)}</div></div></li>`).join('')}</ul>` : `<div class="empty">${tt('No transcript yet.')}</div>`;
  return [
    { id: 'desk', title: tt('Desk'), card: 'main', count: dialog.length || undefined, countClass: 'bad', html: overview },
    { id: 'screen', title: tt('Screen'), card: 'main', html: screen },
    { id: 'transcript', title: tt('Transcript'), card: 'main', html: events },
  ];
}

// stopped: Resume is the main action after a crash; otherwise Start, with Resume of the last session beside it
function startButtons(d) {
  if (d.running) return `<button class="ghost" data-act="stop" data-agent="${d.id}">${tt('Stop')}</button>`;
  if (d.crash && !d.crash.withLead && d.resume) return `<button class="gold" data-act="resume" data-agent="${d.id}" title="${tt('Continue the last session')}">${tt('Resume')}</button><button class="ghost small" data-act="start" data-agent="${d.id}" title="${tt('A new session without the earlier context')}">${tt('Start fresh')}</button>`;
  return `<button class="ok" data-act="start" data-agent="${d.id}">${tt('Start')}</button>${d.resume ? `<button class="ghost small" data-act="resume" data-agent="${d.id}" title="${tt('Continue the last session ({id})', { id: esc(d.resume.sessionId.slice(0, 8)) })}">${tt('Resume last session')}</button>` : ''}`;
}

export function deskSections(floor, d, opts = {}) {
  return deskSectionsInner(floor, d, opts).map((x) => ({ ...x, back: `#/floor/${floor.id}` }));
}
function deskSectionsInner(floor, d, { locked = false, screen: routeScreen = false } = {}) {
  if (locked) return [{ id: 'desk', title: tt('Desk'), card: 'main', html: `<div class="empty">${tt("This desk shows the agent's live screen and transcript, so it needs the local PIN.")}</div><button class="gold" data-act="unlock">${tt('Enter PIN')}</button>` }];
  if (!d) return [{ id: 'desk', title: tt('Desk'), card: 'main', html: `<div class="empty">${tt('Loading…')}</div>` }];
  if (d.independent) return independentDeskSections(floor, d, routeScreen);
  const e = d.effective || {};
  const ts = d.templateStatus || {};
  const o = d.agent.overrides || {};
  const dialog = (floor.attentionItems || []).filter((a) => a.agentId === d.id && (d.dialog || a.kind === 'reply' || a.kind === 'finished'));
  const mr = d.models || {};
  const modelWarn = mr.mismatch
    ? `<div class="att budget warn" style="margin-top:10px"><div class="where">${tt('Model differs')}</div><div class="q">${tt('Configured: <b>{configured}</b>. The latest reply ({ago}) came from <b>{observed}</b>.', { configured: esc(mr.configured), ago: ago(mr.observedAt), observed: esc(mr.observed) })}${mr.restartNeeded ? ` ${tt('The session was started with an older configuration.')}` : d.running ? ` ${tt('The model may have been switched inside the session, or a lead spawned this agent with another model.')}` : ''}</div>
      ${d.running ? `<button class="small" data-act="restart" data-agent="${d.id}">${tt('Restart with {model}', { model: esc(mr.configured) })}</button>` : `<div class="note">${tt('The next start uses the configured model.')}</div>`}</div>`
    : mr.restartNeeded ? `<div class="att stall" style="margin-top:10px"><div class="where">${tt('Restart to apply')}</div><div class="q">${tt('This session started with {old}; the agent is now configured for {model} ({effort} effort).', { old: esc(mr.startedWith), model: esc(mr.configured), effort: esc(e.effort) })}</div>
      <button class="small" data-act="restart" data-agent="${d.id}">${tt('Restart')}</button></div>` : '';
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis" style="font-size:18px">${esc(d.displayName)}</h2>
      <div class="note">${esc(e.title || '')} · ${tt('model {model}', { model: esc(mr.configured || '?') })}${mr.observed ? ` · ${tt('last reply from {model}', { model: `<span class="${mr.mismatch ? 'warnText' : ''}">${esc(mr.observed)}</span>` })}` : ''}</div>
      <div class="note"><i class="dot ${d.standby ? 'standby' : d.state}"></i> ${esc(deskState(d))}</div></div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">${startButtons(d)}
      <a class="chip" style="justify-content:center" href="#/floor/${floor.id}/desk/${d.id}${routeScreen ? '' : '/screen'}">${routeScreen ? tt('Leave screen') : tt('Look at screen')}</a>
      <a class="chip" style="justify-content:center" href="#/floor/${floor.id}/desk/${d.id}/follow" title="${tt('A camera that follows this agent around')}">${tt('Follow')}</a></div></div>`;
  const crashed = d.crash && !d.crash.withLead;
  const crash = crashed ? `<div class="att crash" style="margin-top:10px"><div class="where">${tt('Stopped unexpectedly')}</div><div class="q">${esc(tx(d.crash.text))}</div>
      <div class="note">${d.resume ? (d.lead || d.kindOf === 'lead' ? tt('Resume continues session <code>{id}</code> with its context; the lead is told its teammates died and re-spawns only what is still needed. Start fresh begins a new session.', { id: esc(d.resume.sessionId.slice(0, 8)) }) : tt('Resume continues session <code>{id}</code> with its context. Start fresh begins a new session.', { id: esc(d.resume.sessionId.slice(0, 8)) })) : tt('No previous session was found; start it fresh.')}</div>
${d.resume ? '' : `<div class="row" style="margin-top:8px"><button class="small" data-act="start" data-agent="${d.id}">${tt('Start fresh')}</button></div>`}</div>`
    : d.crash?.withLead ? `<div class="att stall" style="margin-top:10px"><div class="where">${tt('Stopped with the lead')}</div><div class="q">${esc(tx(d.stopNote || d.crash.text))}</div><div class="note">${tt("This teammate ran inside the lead's session. Resume the lead; it re-spawns the teammates whose work is still open.")}</div></div>` : '';
  const update = ts.updateAvailable ? `<div class="att stall" style="margin-top:10px"><div class="where">${tt('Update available')}</div><div class="q">${tt('{title} template v{from} → v{to}', { title: esc(e.title), from: d.agent.role.version, to: ts.latestVersion })}</div>
      <div class="row wrap"><button class="small" data-act="tpl-diff" data-agent="${d.id}">${tt('View diff')}</button><button class="small gold" data-act="tpl-update" data-agent="${d.id}">${tt('Update')}</button><button class="small" data-act="tpl-keep" data-agent="${d.id}">${tt('Keep current')}</button></div></div>` : '';
  const overview = `${head}${crash}${d.task ? taskHtml(d.task) : ''}${modelWarn}${update}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <div class="section"><div class="sectionHead"><h3 class="grow">${tt('Send task')}</h3></div><div data-slot="task"></div>
      ${d.pending ? `<div class="note">${tt('Queued: {text}', { text: esc(d.pending.slice(0, 120)) })}</div>` : ''}
      ${d.work ? `<div class="note" style="margin-top:6px">${d.work.doneAt ? tt('Current work (done {ago}):', { ago: ago(d.work.doneAt) }) : tt('Current work (since {ago}):', { ago: ago(d.work.assignedAt) })} ${esc(d.work.text.slice(0, 160))} <button class="small ghost" data-act="work-done" data-agent="${d.id}">${tt('Clear')}</button></div>` : ''}</div>
    <div class="section note">${tt('Terminal:')} <code>${esc(d.attach)}</code> <button class="small ghost" data-act="copy" data-text="${esc(d.attach)}">${tt('Copy')}</button></div>`;
  const screen = d.running ? `<pre class="screen" data-scroll="screen">${esc(d.screen) || ' '}</pre>` : `<div class="empty">${d.resume ? tt('The agent is stopped. Resume or start it to see its live screen.') : tt('The agent is stopped. Start it to see its live screen.')}</div>`;
  const events = d.events.length ? `<ul class="feed events">${d.events.map((ev) => `<li><span class="k ${ev.kind}"></span><div class="grow"><div><b>${esc(tx(ev.title))}</b>${ev.tool ? ` <span class="note">${esc(ev.tool)}</span>` : ''}</div><div class="d ${ev.kind === 'think' || ev.kind === 'task' ? '' : 'mono'}">${esc(ev.detail)}</div><div class="t">${ago(ev.ts)}</div></div></li>`).join('')}</ul>` : `<div class="empty">${tt('No transcript yet.')}</div>`;
  const pills = (list, cls = '') => list.map((s) => `<span class="pill ${cls}">${esc(s)}</span>`).join('');
  const profile = `<dl class="kv">
      <dt>${tt('Agent id')}</dt><dd><code>${esc(d.id)}</code></dd>
      <dt>${tt('Role')}</dt><dd>${esc(e.title)} ${d.agent.role.detached ? `<span class="badge">${tt('detached copy')}</span>` : `<span class="badge">${esc(d.agent.role.template)}@${d.agent.role.version}</span>`}${ts.keptVersion ? ` <span class="note">${tt('kept (v{version} available)', { version: ts.keptVersion })}</span>` : ''}</dd>
      <dt>${tt('Model (configured)')}</dt><dd>${esc(e.model)}${o.model ? ` <span class="note">${tt('(override)')}</span>` : ''}${mr.startedWith ? ` <span class="note">· ${tt('session started with {model}', { model: esc(mr.startedWith) })}</span>` : ''}</dd>
      <dt>${tt('Model (observed)')}</dt><dd>${mr.observed ? `<span class="${mr.mismatch ? 'warnText' : ''}">${esc(mr.observed)}</span> <span class="note">${ago(mr.observedAt)}${mr.mismatch ? ` · ${tt('differs from the configured model')}` : ''}</span>` : `<span class="note">${tt('no replies yet')}</span>`}</dd>
      <dt>${tt('Effort')}</dt><dd>${esc(e.effort)}${o.effort ? ` <span class="note">${tt('(override)')}</span>` : ''}</dd>
      <dt>${tt('Skills')}</dt><dd>${skillsHtml(d)}${pills(o.skills?.remove || [], 'rm')}${(e.skills || []).length || (o.skills?.remove || []).length ? '' : `<span class="note">${tt('none')}</span>`}</dd>
      <dt>${tt('Tools')}</dt><dd>${pills(e.tools || []) || `<span class="note">${tt('all')}</span>`}</dd>
      <dt>${tt('Not allowed')}</dt><dd>${pills(e.permissions?.deny || [])}</dd>
      <dt>${tt('Rules')}</dt><dd>${(e.rules || []).length ? `<ul style="margin:0;padding-left:18px">${e.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : `<span class="note">${tt('none')}</span>`}${o.rules?.length ? `<div class="note">${tt('{n} added by override', { n: o.rules.length })}</div>` : ''}</dd>
      <dt>${tt('Cost today')}</dt><dd>${money(d.costToday)}</dd>
      <dt>${tt('Voice')}</dt><dd>${d.agent.voice ? tt('chosen voice') : tt("the role's default voice")} <button class="small ghost" data-act="choose-voice" data-agent="${d.id}" data-name="${esc(d.displayName)}" data-voice="${esc(d.agent.voice || '')}" data-lang="${esc(d.agent.voiceLang || '')}" data-vs="${d.agent.voiceSettings ? esc(JSON.stringify(d.agent.voiceSettings)) : ''}">${tt('Change')}</button></dd>
    </dl>
    ${o.prompt ? `<details><summary>${tt('Prompt override')}</summary><div class="note" style="white-space:pre-wrap">${esc(o.prompt)}</div></details>` : ''}
    <details><summary>${tt('Full prompt')}</summary><div class="note" style="white-space:pre-wrap">${esc(e.prompt)}</div></details>
    <div class="actions" style="justify-content:flex-start"><button data-act="edit-agent" data-agent="${d.id}">${tt('Edit agent')}</button>
      ${d.agent.role.detached ? '' : `<button class="ghost" data-act="tpl-detach" data-agent="${d.id}">${tt('Detach from template')}</button>`}
      <button class="ghost danger" data-act="remove-agent" data-agent="${d.id}">${tt('Remove')}</button></div>`;
  return [
    { id: 'desk', title: tt('Desk'), card: 'main', count: dialog.length || undefined, countClass: 'bad', html: overview },
    { id: 'screen', title: tt('Screen'), card: 'main', html: screen },
    { id: 'transcript', title: tt('Transcript'), card: 'main', html: events },
    { id: 'profile', title: tt('Profile'), card: 'main', html: profile },
  ];
}
