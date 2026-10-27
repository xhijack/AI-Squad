// SPDX-License-Identifier: Apache-2.0
// The two runners an agent can run in (Runner v2, 0.11):
//   tmux      an interactive Claude Code session in its own tmux server (the Desk: the owner types, answers dialogs
//             and watches the screen). Its status comes from the plugin hooks and the transcript; the screen is read
//             only for what has no other source (open dialogs, the input box before typing).
//   headless  `claude -p --output-format stream-json` (server/jobs.js): background work with structured events,
//             a session id, cost and a budget cap. Nothing is read from a screen.
// Both take the same agent: its generated agent file (--agent), model, effort, denied tools, linked repositories.
import * as tm from './tmux.js';
import * as jobs from './jobs.js';

export const tmuxRunner = {
  kind: 'tmux',
  start: (spec) => tm.startSession(spec),
  stop: (name) => tm.stopSession(name),
  running: (name) => tm.isRunning(name),
  send: (name, text) => tm.typeTask(name, text),
};
export const headlessRunner = {
  kind: 'headless',
  start: (spec) => jobs.startJob(spec),
  stop: (id) => jobs.stopJob(id),
  running: (id) => jobs.readJob(id)?.status === 'running',
  status: (id) => jobs.jobDetail(id),
};
export const RUNNERS = { tmux: tmuxRunner, headless: headlessRunner };
export const runnerFor = (kind) => RUNNERS[kind] || tmuxRunner;
