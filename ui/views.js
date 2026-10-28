// SPDX-License-Identifier: Apache-2.0
// Panel content for the three places: Lobby, Floor, Desk. Each view returns sections
// { id, title, card: top | main | tabs, html, head?, count? }; app.js lays them out as floating cards in the right
// panel (desktop) or as tabs of the bottom sheet (phone).
import { esc, money, ago, avatar, STATE_TEXT, stateText, drafts, mdLite } from './lib.js';
import { t as tt, tx } from './i18n.js';
import { isAsk, askFormHtml } from './askform.js';
import { primaryAction, deskActionsHtml } from './desk-actions.js';
import { statusOf, statusPill, activityLine } from './status.js';
import { feedHtml } from './feed.js';

const KIND_TEXT = { question: tt('Question'), permission: tt('Permission'), reply: tt('Waiting for your reply'), stall: tt('Stalled'), budget: tt('Budget'), resource: tt('Resources'), merge: tt('Merge'), crash: tt('Stopped unexpectedly'), decided: tt('Decided by autopilot'), finished: tt('Finished'), taskdone: tt('Command ended'), scope: tt('Scope change'), design: tt('Pick a design'), price: tt('Price approval'), handoff: tt('Handoff'), erpnext: 'ERPNext', contract: tt('Contract'), legal: tt('Legal'), canary: tt('Canary') };
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
  return `<div class="att task${t.stall ? ' stall' : ''}" style="margin-top:var(--sp-3)"><div class="where"><span class="grow">${tt('Running')} · ${esc(taskLine(t))}</span>${t.background ? `<span class="note">${tt('in the background')}</span>` : ''}</div>
    ${p ? `<div class="taskBar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p.pct}%"></i></div><div class="note">${p.total ? tt('{done} of {total}', p) : `${p.pct} %`}</div>` : ''}
    ${t.lines?.length ? `<pre class="taskOut">${esc(t.lines.join('\n'))}</pre>` : `<div class="note">${tt('No output yet.')}</div>`}
    ${stall ? `<div class="note warnText">${stall}</div>` : ''}<div class="note"><code>${esc(t.command)}</code></div></div>`;
}

// the owner's real asks first; system notices (stalls) muted under "Notices" below them (1.0.2)
// background services (a dev server, a watcher): not work, not a stall; shown with a Stop button (1.0.2)
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const serviceLine = (s) => tt('Running in the background: {label} · since {time}', { label: s.label, time: hhmm(s.startedAt) });
function servicesHtml(floorId, agentId, services = []) {
  return services.map((s) => `<div class="att service muted" style="margin-top:var(--sp-3)"><div class="row"><span class="grow">${esc(serviceLine(s))}</span>
    <button type="button" class="small ghost danger" data-act="stop-service" data-floor="${esc(floorId)}" data-agent="${esc(agentId)}" data-service="${esc(s.id)}">${tt('Stop')}</button></div>
    ${s.lines?.length ? `<pre class="taskOut">${esc(s.lines.join('\n'))}</pre>` : ''}<div class="note"><code>${esc(s.command)}</code></div></div>`).join('');
}

export function attentionHtml(items, opts = {}) {
  if (!items.length) return `<div class="empty">${tt('All clear. Nothing is waiting for you.')}</div>`;
  const asks = items.filter((a) => !a.notice), notices = items.filter((a) => a.notice);
  return cardsHtml(asks, opts) + (notices.length ? `<h4 class="noticesHead">${tt('Notices')}</h4>${cardsHtml(notices, opts)}` : '');
}
function cardsHtml(items, { showFloor = true, onDesk = false } = {}) {
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
        ? `<div class="row" style="margin-top:var(--sp-2)"><span class="note grow">${a.asks ? tt('It asks you something. This agent runs on its own: reply in its own terminal.') : tt('This agent runs on its own: reply in its own terminal.')}</span><button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('OK')}</button></div>`
        : `<form class="replyForm" data-act="reply" data-id="${a.id}"><textarea name="text" rows="2" data-draft="${a.id}" placeholder="${tt('Reply to {name} (optional)…', { name: who })}" aria-label="${tt('Your reply to {name}', { name: who })}" required>${esc(drafts.get(a.id) || '')}</textarea>
        <div class="row"><span class="note grow">${tt('A reply goes to {name} as the next task.', { name: who })}</span><button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}" title="${tt('Read it; hide the card')}">${tt('OK')}</button><button class="small">${tt('Reply')}</button></div></form>`;
    } else if (a.kind === 'taskdone') {
      // a calm card: the command's duration and result; OK, or the agent's log (its desk)
      body = `<div class="row" style="margin-top:var(--sp-2)"><span class="grow"></span>${a.floorId && a.agentId ? `<a class="chip" href="#/floor/${a.floorId}/desk/${a.agentId}">${tt('Open log')}</a>` : ''}<button type="button" class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('OK')}</button></div>`;
    } else if (a.kind === 'design') {
      body = `<div class="row" style="margin-top:var(--sp-2)"><span class="grow"></span><button class="small gold" data-act="designs" data-screen="${esc(a.screen)}">${tt('See the variants')}</button></div>`;
    } else if (a.kind === 'decided') {
      // a muted card: what Autopilot chose, the other options to change it, OK to keep it
      body = `<div class="note">${tt('Decided automatically: <b>{choice}</b>', { choice: esc(a.chosen) })}</div>
        <div class="row wrap" style="margin-top:var(--sp-2)">${a.options.length ? `<span class="note">${tt('Change answer:')}</span>${a.options.map((o) => `<button class="small" data-act="answer" data-id="${a.id}" data-n="${o.n}">${esc(o.label)}</button>`).join('')}` : ''}
        <span class="spacer"></span><button class="small ghost" data-act="dismiss" data-id="${a.id}" title="${tt('Keep this decision')}">${tt('OK')}</button></div>`;
    } else if (a.kind === 'crash') {
      // Resume continues the agent's last session (the default after a crash); Start fresh loses its context
      body = `<div class="row wrap">${a.options.map((o) => `<button class="small ${o.n === 1 ? 'gold' : 'ghost'}" data-act="crash-answer" data-id="${a.id}" data-n="${o.n}">${o.n === 1 ? tt('Resume') : tt('Start fresh')}</button>`).join('')}
        <button class="small ghost" data-act="dismiss" data-id="${a.id}">${tt('Dismiss')}</button></div>${a.resumable ? `<div class="note" style="margin-top:var(--sp-2)">${tt('Resume continues the last session with its context. Start fresh begins a new session.')}</div>` : ''}`;
    } else if (a.answerable && isAsk(a)) {
      body = askFormHtml(a);                                                     // several questions or multi-select
    } else if (a.answerable && a.options?.length) {
      const lab = (o) => esc(['price', 'handoff', 'contract', 'canary'].includes(a.kind) ? tx(o.label) : o.label);       // the server's own labels are translated
      body = `<div class="opts">${a.options.map((o) => o.free
        ? `<form class="free" data-act="answer-free" data-id="${a.id}" data-n="${o.n}"><input name="text" placeholder="${lab(o)}" aria-label="${tt('Your answer')}" required><button class="gold">${tt('Send')}</button></form>`
        : `<button class="${o.recommended || a.autopilot?.recommended === o.n ? 'gold' : ''}" data-act="answer" data-id="${a.id}" data-n="${o.n}">${o.n}. ${lab(o)}</button>`).join('')}</div>`;
    } else if (a.kind === 'permission' && a.live) {
      body = `<div class="note">${a.agentId ? tt("Reported live by Claude Code. Answer it on the Desk (Screen tab) or in the agent's terminal.") : tt('Reported live by Claude Code.')}</div>`;
    } else if (a.kind === 'question') {
      body = `${a.options?.length ? `<ol class="note">${a.options.map((o) => `<li>${esc(o.label)}</li>`).join('')}</ol>` : ''}<div class="note">${tt("Answer it in the agent's terminal (not started from The AI Squad).")}</div>`;
    }
    const links = [];
    if (a.floorId && a.agentId && !onDesk) links.push(`<a href="#/floor/${a.floorId}/desk/${a.agentId}">${tt('Open desk')}</a>`);
    else if (a.floorId) links.push(`<a href="#/floor/${a.floorId}">${tt('Open Floor')}</a>`);
    if (a.kind === 'stall' || a.kind === 'merge' || a.kind === 'erpnext' || a.kind === 'legal' || (a.kind === 'handoff' && a.mode === 'question')) links.push(`<button class="small ghost" data-act="dismiss" data-id="${a.id}">${['erpnext', 'legal'].includes(a.kind) ? tt('OK') : tt('Dismiss')}</button>`);
    body = apNote(a) + body;
    // a click on the message opens it large (the conversation view)
    const text = a.kind === 'reply' || a.kind === 'finished' ? `<div class="replyMsg md" data-act="convo" data-id="${a.id}" data-scroll="reply-${a.id}"${a.kind === 'finished' ? ' data-top' : ''} tabindex="0" title="${tt('Open large')}" aria-label="${tt('Message from {name}, open large', { name: esc(a.agentName || tt('the agent')) })}">${mdLite(a.text)}</div>` : `<div class="q" data-act="convo" data-id="${a.id}" title="${tt('Open large')}">${esc(a.kind === 'taskdone' && a.task ? taskDoneText(a.task) : SYSTEM_KINDS.has(a.kind) ? tx(a.text) : a.text)}</div>`;
    return `<div class="att ${a.kind} ${a.level || ''}${a.muted ? ' muted' : ''}" data-item-floor="${esc(a.floorId || '')}" data-item-agent="${esc(a.agentId || '')}" data-item-kind="${esc(a.kind)}"><div class="where"><span class="grow">${where} · ${ago(a.ts)}</span><button type="button" class="openBig" data-act="convo" data-id="${a.id}" aria-label="${tt('Open large')}" title="${tt('Open large')}">⤢</button></div>${text}${body}${links.length ? `<div class="row" style="margin-top:var(--sp-2)">${links.join(' ')}</div>` : ''}</div>`;
  }).join('');
}

// what Autopilot does with an item: critical ones wait for the owner; others are answered or nudged after the timeout
function apNote(a) {
  // a hard stop the server decided (a price, a package leaving an Owner-only Space, 0.19): only the Owner
  if (a.hardStop?.length) return `<div class="apNote crit">${tt('Hard stop ({reasons}): only you decide this.', { reasons: esc(a.hardStop.map((r) => tx(r)).join(', ')) })}</div>`;
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
  if (f.missing) return `<div class="frow missing"><span class="fnum" style="--c:var(--neutral)">${f.number}</span><span class="grow"><b>${esc(f.name)}</b><span class="sub">${esc(tx(f.error))}</span></span>
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
      <div class="row" style="margin-top:var(--sp-2)"><span class="spacer"></span><button class="small ghost" data-act="new-floor" title="${tt('A Floor without a Blueprint, set up by hand')}">${tt('+ New Floor by hand')}</button></div>` },
    { id: 'detected', title: tt('Detected'), card: 'main', count: b.detected.length, html: `
      <p class="note" style="margin-top:0">${tt('Directories with Claude Code activity that are not Floors yet.')}</p>
      <div class="list">${detected || `<div class="empty">${tt('Nothing new detected.')}</div>`}</div>` },
  ];
  if (b.attention.length) out.unshift({ id: 'attention', title: tt('Needs you'), card: 'top', count: needsYou(b.attention).length || undefined, countClass: 'bad', html: attentionHtml(b.attention) });
  return out;
}

// ---------- Floor ----------
// the subtitle: role · model, without the role when it only repeats the name ("Project Manager" · "Project Manager")
const sameWords = (x, y) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === String(y || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const roleLine = (a) => [sameWords(String(a.displayName).split(' - ')[0], a.title) ? '' : a.title, a.model].filter(Boolean).join(' · ');
// one row per agent: colour dot, name (+ Lead), role · model, the last activity in plain words, one status pill
export function agentRow(floorId, a, selected) {
  const line = a.task ? { text: taskLine(a.task), full: a.task.lines?.join('\n') || '' } : a.services?.length && statusOf(a) !== 'crashed' ? { text: serviceLine(a.services[0]), full: a.services[0].command || '' } : activityLine(a);
  return `<div class="arow${selected ? ' sel' : ''}${a.task?.stall ? ' taskStall' : ''}" data-href="#/floor/${floorId}/desk/${a.id}" role="button" tabindex="0"${line.full ? ` title="${esc(line.full)}"` : ''}>
    <i class="adot" style="--c:${esc(a.appearance?.shirt || 'var(--info)')}"></i>
    <span class="grow"><span class="nm"><b>${esc(String(a.displayName).split(' - ')[0])}</b>${a.lead ? ` <span class="badge lead">${tt('Lead')}</span>` : ''} <span class="role">${esc(roleLine(a))}</span></span><span class="act">${esc(line.text)}</span></span>
    ${statusPill(a)}</div>`;
}

function messagesHtml(msgs, team) {
  if (!msgs.length) return `<div class="empty">${tt('No messages between agents yet.')}</div>`;
  const name = (id) => String(team.find((a) => a.id === id)?.displayName || id).split(' - ')[0];
  return `<ul class="feed msgs">${msgs.map((m) => `<li><span class="t">${new Date(m.ts).toTimeString().slice(0, 5)}</span><span class="k talk"></span><span class="grow"><b>${esc(String(m.fromName).split(' - ')[0])}</b> → <b>${esc(name(m.to))}</b> <span class="d">${esc(m.text)}</span></span></li>`).join('')}</ul>`;
}

const COLUMN_TEXT = { TODO: tt('To do'), IN_PROGRESS: tt('In progress'), REVIEW: tt('Review'), BLOCKED: tt('Blocked / bugs'), DONE: tt('Done') };
const COLUMN_COLOR = { TODO: 'var(--neutral)', IN_PROGRESS: 'var(--info)', REVIEW: 'var(--violet)', BLOCKED: 'var(--danger)', DONE: 'var(--success)' };
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
  const now = meeting ? `<div class="chip info" style="margin-bottom:var(--sp-2)">${tt('At the table now: {label} ({n} agents)', { label: esc(tx(meeting.label)), n: meeting.agents.length })}</div>` : '';
  if (!s) return `${now}<div class="empty">${tt('No standup yet. It runs every day at the time in Floor settings, from the Squad Log.')}</div><button class="small" data-act="standup-now">${tt('Standup so far today')}</button>`;
  return `${now}<div class="row" style="margin-bottom:var(--sp-2)"><b class="grow">${tt('Standup {when}', { when: esc(new Date(s.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })) })}</b><button class="small ghost" data-act="standup-now">${tt('So far today')}</button></div>
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
  return `<div class="row" style="margin-bottom:var(--sp-2)"><b class="grow">${esc(bp.title)} v${bp.version}</b>${pending ? `<span class="st idle">${tt('{n} not approved', { n: pending })}</span>` : `<span class="st working">${tt('all approved')}</span>`}</div>
    ${bp.latest > bp.version ? `<div class="row" style="margin-bottom:var(--sp-2)"><span class="chip info grow">${tt('Blueprint v{version} available', { version: bp.latest })}</span><button class="small" data-act="blueprint-update">${tt('Update')}</button></div>` : ''}
    <p class="note" style="margin-top:0">${pending ? tt("Roles, channels, gates and the definition of done are in <code>AISQUAD.md</code> and in every agent's prompt. The lead collects the source documents from you first.") : tt("Roles, channels, gates and the definition of done are in <code>AISQUAD.md</code> and in every agent's prompt.")}</p>
    ${bp.sourceDocs.map((d) => `<div class="docRow"><span class="grow"><code>${esc(d.path)}</code><span class="note">${esc(d.purpose)}</span></span><span class="chip ${DOC_STATE[d.status][0]}">${DOC_STATE[d.status][1]}</span></div>`).join('')}
    <div class="row" style="margin-top:var(--sp-2)"><span class="spacer"></span><button class="small ${pending ? 'gold' : ''}" data-act="source-docs">${pending ? tt('Review and approve') : tt('Open source documents')}</button></div>`;
}

// the Autopilot level also sits here (on a phone the top bar has no room for its chip)
const AP_LEVEL = { off: tt('off'), balanced: tt('balanced'), full: tt('full') };
const apMini = (f) => (f.autopilot && !f.independent ? `<button class="chip apMini ${f.autopilot.level}${f.autopilot.critical ? ' crit' : ''}" data-act="floor-settings" title="${tt('Autopilot level (Floor settings)')}">${tt('Autopilot: {level}', { level: AP_LEVEL[f.autopilot.level] || f.autopilot.level })}${f.autopilot.critical ? ` · ${tt('{n} critical', { n: f.autopilot.critical })}` : ''}</button>` : '');
// on a phone the header has no room for status chips: Start squad sits in the Agents card
const startMini = (f) => (!f.independent && f.agents.length && !f.agents.some((a) => a.running) ? `<button class="small gold phoneOnly" data-act="start-all">${tt('Start squad')}</button>` : '');
const agentsHead = (f, extra = '') => `<div class="cardHead"><h3>${tt('Agents')}</h3>${apMini(f)}${startMini(f)}<span class="meta">${tt('{n}/{total} active', { n: f.agents.filter((a) => a.state === 'working' || a.state === 'waiting').length, total: f.agents.length })}</span>${extra}</div>`;

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
// the pill says the state; the text beside it says why or what (a standby text without its "not started:" lead-in)
const upper = (x) => String(x || '').replace(/^./, (c) => c.toUpperCase());
const deskState = (d) => (d.standby ? upper(tx(d.activity).replace(/^[^:]{0,24}:\s*/, ''))
  : d.crash && !d.crash.withLead ? tx(d.crash.text) : d.stopNote ? upper(tx(d.stopNote))
  : d.waitingReply ? stateText(d) : d.activity && d.state !== 'stopped' ? upper(tx(d.activity)) : d.lastTs ? tt('last seen {ago}', { ago: ago(d.lastTs) }) : '');
const deskStatus = (d) => `<div class="deskState">${statusPill(d)}<span class="grow">${esc(deskState(d))}</span></div>`;
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
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis">${esc(d.displayName)}</h2>
      <div class="deskSub">${esc(d.title)}${d.models?.observed ? modelChip(d.models.observed, tt('Last reply from this model')) : ''}</div>
      ${deskStatus(d)}</div></div>
      <div class="deskActions"><button class="gold" data-act="adopt-agent" data-agent="${d.id}">${tt('Adopt into a squad')}</button>
      <a class="btn ghost" href="#/floor/${floor.id}/desk/${d.id}${routeScreen ? '' : '/screen'}">${routeScreen ? tt('Leave screen') : tt('Look at screen')}</a></div>`;
  const overview = `${head}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <dl class="kv" style="margin-top:var(--sp-3)"><dt>${tt('Directory')}</dt><dd><code>${esc(d.root)}</code></dd><dt>${tt('Runs in')}</dt><dd>${esc(d.via)}${d.pid ? ` <span class="note">pid ${d.pid}</span>` : ''}</dd><dt>${tt('Cost today')}</dt><dd>${money(d.costToday)}</dd></dl>
    <p class="note">${tt('An independent agent: The AI Squad shows its status, screen, transcript and questions, but does not start, stop or give it tasks. Adopt it to make it a member of a squad.')}</p>
    ${d.attach ? advancedHtml(d.attach) : ''}`;
  const screen = d.screen ? `<pre class="screen" data-scroll="screen">${esc(d.screen)}</pre>` : `<div class="empty">${d.running ? tt('This agent does not run in tmux, so its screen cannot be shown. Its transcript is in the Transcript tab.') : tt('No Claude Code process is running for this agent.')}</div>`;
  const events = d.events.length ? `<ul class="feed events">${d.events.map((ev) => `<li><span class="k ${ev.kind}"></span><div class="grow"><div><b>${esc(tx(ev.title))}</b>${ev.tool ? ` <span class="note">${esc(ev.tool)}</span>` : ''}</div><div class="d ${ev.kind === 'think' || ev.kind === 'task' ? '' : 'mono'}">${esc(ev.detail)}</div><div class="t">${ago(ev.ts)}</div></div></li>`).join('')}</ul>` : `<div class="empty">${tt('No transcript yet.')}</div>`;
  return [
    { id: 'desk', title: tt('Desk'), card: 'main', count: dialog.length || undefined, countClass: 'bad', html: overview },
    { id: 'screen', title: tt('Screen'), card: 'main', html: screen },
    { id: 'transcript', title: tt('Transcript'), card: 'main', html: events },
  ];
}

// a model name as one chip: never broken mid-token
const modelChip = (model, title, warn = false) => `<span class="chip model${warn ? ' warn' : ''}" title="${esc(title)}">${esc(model)}</span>`;
// owner-facing first: the tmux attach command sits in a collapsed Advanced section
const advancedHtml = (attach) => `<details class="section advanced"><summary>${tt('Advanced')}</summary><div class="note">${tt('Terminal:')}</div>
  <div class="row"><code class="grow attach">${esc(attach)}</code><button class="small" data-act="copy" data-text="${esc(attach)}">${tt('Copy')}</button></div></details>`;

// background jobs (headless runner, 0.11): status, title, cost; Stop while it runs, Open for what it did
const JOB_TEXT = { running: tt('Running'), done: tt('Done'), failed: tt('Failed'), stopped: tt('Stopped') };
function jobsHtml(d) {
  if (!d.jobs?.length) return '';
  return `<div class="section"><div class="sectionHead"><h3 class="grow">${tt('Background jobs')}</h3></div><ul class="list jobs">${d.jobs.map((j) => `<li class="job ${esc(j.status)}">
    <div class="row"><span class="badge">${esc(JOB_TEXT[j.status] || j.status)}</span><span class="grow ellipsis" title="${esc(j.title)}">${esc(j.title)}</span><span class="note">${money(j.cost)} · ${ago(j.startedAt)}</span>
    ${j.status === 'running' ? `<button class="small ghost" data-act="job-stop" data-job="${esc(j.id)}">${tt('Stop')}</button>` : ''}<button class="small ghost" data-act="job-open" data-job="${esc(j.id)}">${tt('Open')}</button></div>
    ${j.status === 'running' && j.activity ? `<div class="note ellipsis">${esc(j.activity)}</div>` : ''}${j.error ? `<div class="note warnText">${esc(tx(j.error))}</div>` : ''}</li>`).join('')}</ul></div>`;
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
    ? `<div class="att budget warn" style="margin-top:var(--sp-3)"><div class="where">${tt('Model differs')}</div><div class="q">${tt('Configured: <b>{configured}</b>. The latest reply ({ago}) came from <b>{observed}</b>.', { configured: esc(mr.configured), ago: ago(mr.observedAt), observed: esc(mr.observed) })}${mr.restartNeeded ? ` ${tt('The session was started with an older configuration.')}` : d.running ? ` ${tt('The model may have been switched inside the session, or a lead spawned this agent with another model.')}` : ''}</div>
      ${d.running ? `<button class="small" data-act="restart" data-agent="${d.id}">${tt('Restart with {model}', { model: esc(mr.configured) })}</button>` : `<div class="note">${tt('The next start uses the configured model.')}</div>`}</div>`
    : mr.restartNeeded ? `<div class="att stall" style="margin-top:var(--sp-3)"><div class="where">${tt('Restart to apply')}</div><div class="q">${tt('This session started with {old}; the agent is now configured for {model} ({effort} effort).', { old: esc(mr.startedWith), model: esc(mr.configured), effort: esc(e.effort) })}</div>
      <button class="small" data-act="restart" data-agent="${d.id}">${tt('Restart')}</button></div>` : '';
  const primary = primaryAction(d, dialog);
  const head = `<div class="deskHead">${avatar(d)}<div class="grow" style="min-width:0"><h2 class="ellipsis">${esc(d.displayName)}</h2>
      <div class="deskSub">${esc(e.title || '')}${modelChip(mr.configured || '?', tt('Configured model'))}${mr.observed && mr.observed !== mr.configured ? modelChip(mr.observed, tt('Last reply from this model'), mr.mismatch) : ''}</div>
      ${deskStatus(d)}</div></div>
      ${deskActionsHtml(d, primary, { floorId: floor.id, screen: routeScreen })}`;
  const crashed = d.crash && !d.crash.withLead;
  const crash = crashed ? `<div class="att crash" style="margin-top:var(--sp-3)"><div class="where">${tt('Stopped unexpectedly')}</div><div class="q">${esc(tx(d.crash.text))}</div>
      <div class="note">${d.resume ? (d.lead || d.kindOf === 'lead' ? tt('Resume continues session <code>{id}</code> with its context; the lead is told its teammates died and re-spawns only what is still needed. Start fresh begins a new session.', { id: esc(d.resume.sessionId.slice(0, 8)) }) : tt('Resume continues session <code>{id}</code> with its context. Start fresh begins a new session.', { id: esc(d.resume.sessionId.slice(0, 8)) })) : tt('No previous session was found; start it fresh.')}</div>
${d.resume ? '' : `<div class="row" style="margin-top:var(--sp-2)"><button class="small" data-act="start" data-agent="${d.id}">${tt('Start fresh')}</button></div>`}</div>`
    : d.crash?.withLead ? `<div class="att stall" style="margin-top:var(--sp-3)"><div class="where">${tt('Stopped with the lead')}</div><div class="q">${esc(tx(d.stopNote || d.crash.text))}</div><div class="note">${tt("This teammate ran inside the lead's session. Resume the lead; it re-spawns the teammates whose work is still open.")}</div></div>` : '';
  // a template update is a compact notice, never the panel's primary action
  const update = ts.updateAvailable ? `<div class="notice"><span class="grow">${tt('Template update: v{from} → v{to}', { from: d.agent.role.version, to: ts.latestVersion })}</span>
      <button class="small ghost" data-act="tpl-diff" data-agent="${d.id}">${tt('View diff')}</button><button class="small" data-act="tpl-update" data-agent="${d.id}">${tt('Update')}</button><button class="small ghost" data-act="tpl-keep" data-agent="${d.id}">${tt('Keep current')}</button></div>` : '';
  const overview = `${head}${crash}${d.task ? taskHtml(d.task) : ''}${servicesHtml(d.floorId, d.id, d.services)}${modelWarn}${update}
    ${dialog.length ? `<div class="section">${attentionHtml(dialog, { showFloor: false, onDesk: true })}</div>` : ''}
    <div class="section"><div class="sectionHead"><h3 class="grow">${tt('Send task')}</h3></div><div data-slot="task" data-primary="${primary === 'send' ? 1 : 0}"></div>
      ${d.pending ? `<div class="note">${tt('Queued: {text}', { text: esc(d.pending.slice(0, 120)) })}</div>` : ''}
      ${d.work ? `<div class="note" style="margin-top:var(--sp-2)">${d.work.doneAt ? tt('Current work (done {ago}):', { ago: ago(d.work.doneAt) }) : tt('Current work (since {ago}):', { ago: ago(d.work.assignedAt) })} ${esc(d.work.text.slice(0, 160))} <button class="small ghost" data-act="work-done" data-agent="${d.id}">${tt('Clear')}</button></div>` : ''}</div>
    ${jobsHtml(d)}
    ${advancedHtml(d.attach)}`;
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
      <dt>${tt('Rules')}</dt><dd>${(e.rules || []).length ? `<ul style="margin:0;padding-left:var(--sp-5)">${e.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : `<span class="note">${tt('none')}</span>`}${o.rules?.length ? `<div class="note">${tt('{n} added by override', { n: o.rules.length })}</div>` : ''}</dd>
      ${d.repos?.length ? `<dt>${tt('Repositories')}</dt><dd>${d.repos.map((r) => `<span class="pill" title="${esc(r.abs)}">${esc(r.id)} · ${r.access === 'write' ? tt('write') : tt('read only')}</span>`).join(' ')}</dd>` : ''}
      <dt>${tt('Cost today')}</dt><dd>${money(d.costToday)}</dd>
      ${d.usage ? `<dt>${tt('RAM and CPU')}</dt><dd>${Math.round(d.usage.rss / 2 ** 20)} MB · ${d.usage.cpu} % <span class="note">${tt('{n} processes', { n: d.usage.procs })}</span></dd>` : ''}
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
