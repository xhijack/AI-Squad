// Squad Log dialog (dock): the Floor's log as a timeline (filter by agent, category, sprint and time range) and as a
// conversation (who talked to whom, in order). The Audit dialog opens it on one event for its evidence links.
import { esc, api, openModal } from './lib.js';
import { ctx } from './ctx.js';

const CAT_CHIP = { lifecycle: 'info', work: 'ok', communication: 'warn', tools: '', usage: '', idle: 'warn', audit: 'info' };
const BAD = new Set(['agent.crashed', 'gate.failed', 'merge.refused']);
const TALK = new Set(['task.given', 'task.delegated', 'message.sent', 'question.asked', 'question.answered']);
const RANGES = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['0', 'All']];
const PAGE = 300;

let S = null;            // { floorId, data, agent, cat, sprint, range, view, shown, focus, open: Set }

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayLabel = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const failed = (e) => BAD.has(e.type) || (e.type === 'tool.call' && e.data?.ok === false) || (e.type === 'qa.report' && e.data?.status === 'FAIL');

function filtered() {
  return S.data.events.filter((e) => (!S.agent || e.agent === S.agent) && (!S.cat || S.data.types[e.type] === S.cat) && (!S.sprint || String(e.sprint) === S.sprint))
    .filter((e) => S.view !== 'talk' || TALK.has(e.type));
}

function rowHtml(e) {
  const cat = S.data.types[e.type] || '';
  const open = S.open.has(e.id) || S.focus === e.id;
  return `<li class="logRow${failed(e) ? ' bad' : ''}${S.focus === e.id ? ' focus' : ''}" data-ev="${esc(e.id)}">
    <button class="logLine" type="button" aria-expanded="${open}"><time>${time(e.ts)}</time><span class="chip ${failed(e) ? 'bad' : CAT_CHIP[cat] || ''}">${esc(e.type)}</span>
      <span class="logSum">${esc(e.summary)}</span>${e.module ? `<span class="note">${esc(e.module)}</span>` : ''}</button>
    ${open ? `<div class="logDetail mono">${esc(JSON.stringify({ agent: e.agent, role: e.role, sprint: e.sprint, module: e.module, session: e.session, model: e.model, id: e.id, ...e.data }, null, 1).replace(/^\{\n|\n\}$/g, ''))}</div>` : ''}</li>`;
}

// conversation: one line per message, sender -> receiver
function talkHtml(e) {
  const d = e.data || {};
  const [from, to, text] = {
    'task.given': [d.by || 'owner', e.agent, d.text], 'task.delegated': [e.agent, d.to, d.text], 'message.sent': [e.agent, d.to, d.text],
    'question.asked': [e.agent, 'owner', d.text], 'question.answered': ['owner', e.agent, d.answer],
  }[e.type];
  const len = d.textChars || d.answerChars;
  return `<li class="talk${S.focus === e.id ? ' focus' : ''}" data-ev="${esc(e.id)}"><time>${time(e.ts)}</time><b>${esc(from || '?')}</b><span class="arrow">→</span><b>${esc(to || '?')}</b>
    ${e.type.startsWith('question') ? `<span class="chip warn">${e.type === 'question.asked' ? 'question' : `answer · ${Math.round((d.waitMs || 0) / 60000)} min`}</span>` : ''}
    <p>${text ? esc(text) : `<span class="note">${len ? `${len} characters, text not logged` : 'no text'}</span>`}</p></li>`;
}

function listHtml(list) {
  if (!list.length) return `<div class="empty">${S.data.events.length ? 'Nothing matches these filters.' : 'No events yet. The log fills while the squad works.'}</div>`;
  const shown = list.slice(-S.shown).reverse();
  let day = '', out = '';
  for (const e of shown) {
    const d = dayLabel(e.ts);
    if (d !== day) { out += `<li class="logDay">${esc(d)}</li>`; day = d; }
    out += S.view === 'talk' ? talkHtml(e) : rowHtml(e);
  }
  return `<ul class="logList${S.view === 'talk' ? ' talkList' : ''}">${out}</ul>${list.length > S.shown ? `<button class="ghost" data-more>Show older (${list.length - S.shown} more)</button>` : ''}`;
}

function draw() {
  const d = S.data, list = filtered();
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  const body = openModal(`<div class="mHead">${S.back ? '<button class="ghost small" data-back>← Audit</button>' : ''}<h3 class="grow">Squad Log · ${esc(ctx.state.floor?.name || S.floorId)}</h3><button class="ghost iconBtn" data-close aria-label="Close">×</button></div>
    <div class="mBody">
      <div class="logFilters">
        <div class="seg" role="group" aria-label="View"><button type="button" data-view="all" aria-pressed="${S.view !== 'talk'}">Timeline</button><button type="button" data-view="talk" aria-pressed="${S.view === 'talk'}">Conversation</button></div>
        <label>Agent <select data-f="agent">${opt('', 'Everyone', S.agent)}${d.agents.map((a) => opt(a, a, S.agent)).join('')}</select></label>
        ${S.view === 'talk' ? '' : `<label>Type <select data-f="cat">${opt('', 'All types', S.cat)}${d.categories.map((c) => opt(c, c, S.cat)).join('')}</select></label>`}
        ${d.sprints.length ? `<label>Sprint <select data-f="sprint">${opt('', 'All', S.sprint)}${d.sprints.map((n) => opt(n, `Sprint ${n}`, S.sprint)).join('')}</select></label>` : ''}
        <label>Range <select data-f="range">${RANGES.map(([v, l]) => opt(v, l, S.range)).join('')}</select></label>
        <span class="note grow logCount">${list.length} of ${d.events.length} events</span>
      </div>
      ${listHtml(list)}
      <p class="note">Machine-local log in <code>~/.aisquad/logs/${esc(S.floorId)}/</code>. Secrets are removed and personal data is masked${ctx.state.floor?.floor?.log?.messages === false ? '; message text is not logged on this Floor' : ''}. Schema: <code>docs/LOG-SCHEMA.md</code>.</p>
    </div>`);
  body.closest('dialog').classList.add('wide');
  body.querySelector('[data-close]').onclick = () => body.closest('dialog').close();
  body.querySelector('[data-back]')?.addEventListener('click', () => ctx.reopenAudit?.());
  body.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { S.view = b.dataset.view; S.shown = PAGE; draw(); });
  body.querySelectorAll('[data-f]').forEach((sel) => sel.onchange = () => { S[sel.dataset.f] = sel.value; S.shown = PAGE; S.focus = null; sel.dataset.f === 'range' ? load() : draw(); });
  body.querySelector('[data-more]')?.addEventListener('click', () => { S.shown += PAGE; draw(); });
  body.querySelectorAll('.logLine').forEach((b) => b.onclick = () => { const id = b.closest('[data-ev]').dataset.ev; S.open.has(id) ? S.open.delete(id) : S.open.add(id); if (S.focus === id) S.focus = null; draw(); });
  if (S.focus) body.querySelector(`[data-ev="${CSS.escape(S.focus)}"]`)?.scrollIntoView({ block: 'center' });
}

async function load() {
  const from = S.range === '0' ? '' : String(Date.now() - Number(S.range) * 864e5);
  S.data = await api('GET', `/api/floors/${S.floorId}/log?limit=20000${from ? `&from=${from}` : ''}`);
  draw();
}

// opts: { focus: event id, agent, cat, range } (from the Audit dialog's evidence links)
ctx.actions.log = async (arg) => {
  const opts = arg instanceof Element ? {} : arg || {};
  const floorId = ctx.state.route.floorId;
  S = { floorId, back: !!opts.back, data: null, agent: opts.agent || '', cat: opts.cat || '', sprint: '', range: opts.range || '7', view: 'all', shown: PAGE, focus: opts.focus || null, open: new Set() };
  if (opts.focus) { S.range = '0'; S.shown = 100000; }
  await load();
};
