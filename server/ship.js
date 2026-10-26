// Ship readiness: which gates and reviews ran for a sprint, and what is still missing before a merge or a deploy.
// Read from the repo (board, QA reports, release notes, plan review, security findings, environments) so the merge
// executor, the Ship readiness panel and the DevOps deploy skill check the same list.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './util.js';
import { parseTasks } from './sprint.js';
import { planReview } from './collect.js';

const status = (t) => ((String(t || '').match(/^STATUS:[ \t]*([A-Za-z]+)/m) || [])[1] || '').toUpperCase();
const md = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; } };

// root: the project; sprint: number; team: [{ template }]. -> { sprint, items: [{ key, label, ok, detail, for }], merge, deploy }
// for: 'merge' (needed before the sprint merges), 'deploy' (needed before a deploy), 'info' (shown, never blocks)
export function readiness(root, { sprint, team = [] } = {}) {
  const squad = path.join(root, 'docs', 'squad');
  const has = (re) => team.some((a) => re.test(a.template || a.role?.template || ''));
  const items = [];
  const add = (key, label, ok, detail, needFor) => items.push({ key, label, ok: !!ok, detail, for: needFor });
  // QA per module: every BUILD row has its QA row DONE and a QA report with STATUS: PASS
  const tasks = parseTasks(readText(path.join(squad, 'TASKS.md')) ?? readText(path.join(root, 'docs', 'BOARD.md')) ?? '');   // Squad Sprint board, else a Blueprint squad's board
  const mods = [...new Set(tasks.map((t) => (t.task.match(/\bM\d+\b/) || [])[0]).filter(Boolean))];
  const qaPass = mods.filter((m) => [path.join(squad, 'qa', `${m}.md`), path.join(squad, `sprint-${sprint}`, 'qa', `${m}.md`)].some((f) => status(readText(f)) === 'PASS'));
  const missingQa = mods.filter((m) => !qaPass.includes(m));
  add('qa', 'QA pass for every module', mods.length && !missingQa.length, mods.length ? (missingQa.length ? `no QA PASS yet: ${missingQa.join(', ')}` : `${mods.length} of ${mods.length} modules passed`) : 'no modules on the board', 'merge');
  // the final smoke test of the sprint
  const final = [path.join(squad, `sprint-${sprint}`, 'qa', `FINAL-S${sprint}.md`), path.join(squad, 'qa', `FINAL-S${sprint}.md`)].map(readText).find((t) => t != null);
  add('smoke', 'Final smoke test', status(final) === 'PASS', final == null ? `docs/squad/qa/FINAL-S${sprint}.md missing` : `STATUS: ${status(final) || '?'}`, 'merge');
  // release notes (docs updated)
  const release = readText(path.join(squad, `sprint-${sprint}`, 'RELEASE.md'));
  add('docs', 'Release notes and docs updated', release != null && release.trim().length > 0, release == null ? `docs/squad/sprint-${sprint}/RELEASE.md missing` : 'RELEASE.md written', 'merge');
  // plan review: design and security sections
  const review = readText(path.join(squad, `sprint-${sprint}`, 'PLAN-REVIEW.md'));
  const pr = review ? planReview(review) : null;
  add('planReview', 'Plan review before the sprint', !!pr && pr.engineering === 'OK', !pr ? 'no PLAN-REVIEW.md' : `engineering ${pr.engineering || '?'}`, 'info');
  add('design', 'Design review', !has(/designer/) || (pr && pr.designScore != null) || md(path.join(squad, 'review')).length > 0,
    has(/designer/) ? (pr?.designScore != null ? `design ${pr.designScore}/10 in the plan review` : 'no design review yet') : 'no designer on the team', has(/designer/) ? 'merge' : 'info');
  // security: plan review verdict, and no open Critical or High finding in docs/squad/security/
  const sec = md(path.join(squad, 'security')).map((f) => readText(path.join(squad, 'security', f)) || '');
  const openHigh = sec.flatMap((t) => t.split(/^## /m).slice(1)).filter((x) => /^S\d+\s*·\s*(Critical|High)\b/i.test(x) && !/^STATUS:\s*(FIXED|ACCEPTED|CLOSED)/mi.test(x)).length;
  const secNeeded = has(/security/);
  add('security', 'Security review', !secNeeded || (pr?.security === 'OK' && !openHigh),
    secNeeded ? (openHigh ? `${openHigh} open Critical / High finding${openHigh === 1 ? '' : 's'}` : pr?.security ? `plan review ${pr.security}` : 'no security review yet') : 'no Security Engineer on the team', secNeeded ? 'merge' : 'info');
  // rollback tried (DevOps writes "Rollback tried: <date>" in docs/ENVIRONMENTS.md)
  const env = readText(path.join(root, 'docs', 'ENVIRONMENTS.md')) || '';
  const tried = env.match(/rollback (?:tried|tested)[^\n]*?(\d{4}-\d{2}-\d{2})/i);
  add('rollback', 'Rollback tried on staging', !!tried, tried ? `tried ${tried[1]}` : 'no "Rollback tried: <date>" in docs/ENVIRONMENTS.md', 'deploy');
  const missing = (need) => items.filter((i) => !i.ok && (i.for === 'merge' || (need === 'deploy' && i.for === 'deploy')));
  return { sprint, items, merge: { ready: !missing('merge').length, missing: missing('merge').map((i) => i.label) }, deploy: { ready: !missing('deploy').length, missing: missing('deploy').map((i) => i.label) } };
}
