// SPDX-License-Identifier: Apache-2.0
// The List view (0.17): the company as plain DOM, no canvas at all — the default overview on phones and the
// lightest of the three. Departments, then projects, then independent agents; each Space with its agents, their
// state and what they do; a tap opens the Space or the Desk. It speaks the scene interface like the others, so
// ui/renderer.js can switch to it.
import { agentStatus } from './scene.js';
import { t as tt } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATE = { working: tt('working'), waiting: tt('needs you'), idle: tt('idle'), stopped: tt('stopped') };

export class ListScene {
  constructor(container, handlers = {}) {
    this.kind = 'list';
    this.handlers = handlers;
    this.el = Object.assign(document.createElement('div'), { className: 'listView' });
    container.append(this.el);
    this.floors = []; this.company = {}; this.insets = {}; this.view = { mode: 'lobby' };
    this.quality = { chosen: 'auto', active: 'low', set() {}, sample() {}, setAO() {} };
    this.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-agent]');
      if (a) return this.handlers.onPickAgent?.(a.dataset.floor, a.dataset.agent);
      const f = e.target.closest('[data-floor]');
      if (f) return this.handlers.onPickFloor?.(f.dataset.floor);
      if (e.target.closest('[data-queue]')) return this.handlers.onPickQueue?.();
      if (e.target.closest('[data-owner]')) return this.handlers.onPickOwner?.();
      if (e.target.closest('[data-server]')) return this.handlers.onPickRack?.();
      if (e.target.closest('[data-targets]')) return this.handlers.onPickTargets?.();
      return null;
    });
  }
  sync(floors) { this.floors = floors || []; this.render(); }
  setCompany(c) { this.company = c || {}; this.render(); }
  setView(view) { this.view = view; this.el.hidden = view.mode !== 'lobby'; }
  setInsets(i) {
    this.insets = { left: 0, right: 0, top: 0, bottom: 0, ...i };
    Object.assign(this.el.style, { paddingTop: `${this.insets.top + 8}px`, paddingBottom: `${this.insets.bottom + 16}px`, paddingLeft: `${this.insets.left + 16}px`, paddingRight: `${this.insets.right + 16}px` });
  }
  setTheme() {}
  setLoad() {} setLiveText() {} setBoard() {} setShot() {} say() {} focusAgent() {} unfocus() {} resize() {}
  dispose() { this.el.remove(); }

  render() {
    const key = JSON.stringify([this.floors, this.company]);
    if (key === this.key) return;
    this.key = key;
    const c = this.company, res = c.resources || {};
    const group = (title, list) => (list.length ? `<h3 class="lvGroup">${esc(title)}</h3>${list.map(card).join('')}` : '');
    const deps = this.floors.filter((f) => f.kind === 'department' && !f.independent);
    const projects = this.floors.filter((f) => f.kind !== 'department' && !f.independent);
    const ind = this.floors.filter((f) => f.independent);
    this.el.innerHTML = `<div class="lvTop">
        <button class="lvStat" data-owner><b class="${c.attention ? 'bad' : ''}">${c.attention || 0}</b><span>${tt('waiting for you')}</span></button>
        <button class="lvStat" data-queue><b>${c.queued || 0}</b><span>${tt('queued')}</span></button>
        <button class="lvStat" data-server><b>${c.limits ? `${c.limits.running}/${c.limits.maxAgents}` : '–'}</b><span>${res.mem?.available != null ? tt('agents · {gb} GB free', { gb: (res.mem.available / 2 ** 30).toFixed(1) }) : tt('agents')}</span></button>
        ${c.targets?.total ? `<button class="lvStat" data-targets><b class="${c.targets.behind ? 'bad' : ''}">${c.targets.met}/${c.targets.total}</b><span>${c.targets.behind ? (c.targets.acting ? tt('targets met · {n} behind · {a} acting', { n: c.targets.behind, a: c.targets.acting }) : tt('targets met · {n} behind', { n: c.targets.behind })) : tt('targets met')}</span></button>` : ''}
      </div>
      ${group(tt('Departments'), deps)}${group(tt('Projects'), projects)}${group(tt('On their own'), ind)}
      ${this.floors.length ? '' : `<div class="empty">${tt('No Spaces yet. Set up a Squad or create a Floor first.')}</div>`}`;
  }
}

function card(f) {
  const agents = f.agents || [];
  const working = agents.filter((a) => a.state === 'working').length, waiting = agents.filter((a) => a.state === 'waiting' || a.waitingReply).length;
  return `<section class="lvCard" style="--c:${esc(f.accent || '#7c5cd6')}">
    <button class="lvHead" data-floor="${esc(f.id)}"><i class="lamp ${esc(f.lamp || '')}"></i><b>${f.number}</b><span class="grow">${esc(f.name)}</span>
      ${waiting ? `<span class="badge bad">${tt('{n} need you', { n: waiting })}</span>` : ''}<span class="note">${tt('{a}/{n} working', { a: working, n: agents.length })}</span></button>
    ${agents.length ? `<ul>${agents.map((a) => `<li><button data-floor="${esc(f.id)}" data-agent="${esc(a.id)}"><i class="dot ${esc(a.state || 'stopped')}"></i>
      <span class="grow"><b>${esc(String(a.displayName || '').split(' - ')[0])}</b> <span class="note">${esc(a.title || '')}</span><br><span class="lvAct ${esc(a.state || '')}">${esc(agentStatus(a) || STATE[a.state] || '')}</span></span>
      ${a.state === 'waiting' || a.waitingReply ? '<span class="q">?</span>' : ''}</button></li>`).join('')}</ul>` : `<div class="note lvEmpty">${f.missing ? tt('Directory not found') : tt('No agents yet.')}</div>`}
  </section>`;
}
