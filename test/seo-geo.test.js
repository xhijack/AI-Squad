// SPDX-License-Identifier: Apache-2.0
// The SEO & GEO Blueprint (1.8): parsed with its roles and counts, the built-in Google MCP and the night shift; the hard
// stops in every role file and in ownerOnly; a Space set up from it gets the pack, the Google MCP in .mcp.json with
// IndexNow on ask, its targets (seeded without goals, measured from Google, waiting quietly until Google is connected)
// and its routines (all off, at night, a quarterly one among them); content-writer is v3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch } from './helpers.js';
import { configure } from '../server/config.js';
import * as bp from '../server/blueprints.js';
import * as building from '../server/building.js';
import * as floors from '../server/floors.js';
import * as kpi from '../server/kpi.js';
import * as cadence from '../server/cadence.js';
import * as skills from '../server/skills.js';
import { listTemplates } from '../server/roles.js';
import { createSquad } from '../server/setup.js';

const root = scratch();
configure({ useHooks: false, useSystemd: false });
building.setPrefs({ squadsDir: path.join(root, 'squads') });
const ROLES = ['seo-geo-strategist', 'technical-seo-specialist', 'keyword-researcher', 'content-writer', 'geo-analyst', 'local-seo-specialist'];

test('the Blueprint: roles and counts, the lead, the Google MCP, a team department working nights', () => {
  const b = bp.getBlueprint('seo-geo');
  assert.equal(b.title, 'SEO & GEO');
  assert.equal(b.workflow, 'free-team');
  assert.equal(b.lead, 'seo-geo-strategist');
  assert.deepEqual(b.roles.map((r) => [r.template, r.min, r.default, r.max]), [['seo-geo-strategist', 1, 1, 1], ['technical-seo-specialist', 0, 1, 1], ['keyword-researcher', 0, 1, 1], ['content-writer', 0, 1, 2], ['geo-analyst', 0, 1, 1], ['local-seo-specialist', 0, 0, 1]]);
  assert.deepEqual(b.mcp, ['aisquad-google']);
  assert.equal(b.space.access, undefined, 'a team Space');
  assert.deepEqual([b.space.kind, b.space.shift.from, b.space.shift.to], ['department', '22:00', '05:00']);
  assert.deepEqual(b.sourceDocs.map((d) => d.path), ['docs/SEO-BRIEF.md', 'docs/BRAND.md', 'docs/seo/KEYWORDS.md', 'docs/seo/PROMPTS.md']);
  assert.equal(b.gates.length, 7);
  assert.match(b.kickoff, /Google access/);
});

test('hard stops: in every role file and in ownerOnly', () => {
  const b = bp.getBlueprint('seo-geo');
  for (const x of ['publishing', 'live copy', 'IndexNow submit', 'outreach e-mail', 'paid SEO tools', 'black-hat techniques']) assert.ok(b.ownerOnly.includes(x), x);
  const tpl = Object.fromEntries(listTemplates().map((t) => [t.role, t]));
  for (const r of ROLES) {
    const text = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates', 'roles', `${r}.md`), 'utf8');
    assert.match(text, /publish/i, `${r}: publishing`);
    assert.match(text, /black-hat|keyword stuffing/i, `${r}: black-hat`);
    assert.match(text, /invent/i, `${r}: never invent`);
    assert.ok(tpl[r], `${r} is a template`);
  }
  for (const r of ['seo-geo-strategist', 'technical-seo-specialist', 'keyword-researcher', 'geo-analyst', 'local-seo-specialist']) assert.match(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates', 'roles', `${r}.md`), 'utf8'), /paid SEO tool/, `${r}: paid tools`);
  for (const r of ['keyword-researcher', 'content-writer', 'geo-analyst', 'local-seo-specialist']) assert.ok(tpl[r].permissions.deny.includes('mcp__aisquad-google__indexnow_submit'), `${r} never submits`);
  assert.equal(tpl['content-writer'].version, 3);
  assert.ok(['content-brief', 'content-refresh'].every((s) => tpl['content-writer'].skills.includes(s)));
});

test('Set up Squad: the pack, the Google MCP on ask, targets measured from Google without goals, routines off at night', async () => {
  const team = [['seo-geo-strategist', 'Sinta - Lead', true], ['technical-seo-specialist', 'Teddy - Tech'], ['keyword-researcher', 'Kiki - Keywords'], ['content-writer', 'Wulan - Writer'], ['geo-analyst', 'Gina - GEO']].map(([template, displayName, lead]) => ({ template, displayName, lead: !!lead }));
  const r = await createSquad({ blueprint: 'seo-geo', name: 'Acme Search', team, installSkills: true });
  const f = floors.readFloor(r.path).floor;
  assert.deepEqual([f.access, f.kind, f.shift.enabled], ['team', 'department', true]);
  for (const doc of ['docs/SEO-BRIEF.md', 'docs/BRAND.md', 'docs/seo/KEYWORDS.md', 'docs/seo/PROMPTS.md', 'docs/seo/plan.md', 'docs/seo/AUDIT.md', 'docs/seo/INDEXNOW.md', 'docs/BOARD.md', 'docs/QUESTIONS.md', 'docs/seo/llms.txt', 'docs/seo/briefs/TEMPLATE.md']) assert.ok(fs.existsSync(path.join(r.path, doc)), doc);
  const mcp = JSON.parse(fs.readFileSync(path.join(r.path, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers['aisquad-google']);
  const st = JSON.parse(fs.readFileSync(path.join(r.path, '.claude', 'settings.json'), 'utf8'));
  assert.ok(st.permissions.ask.includes('mcp__aisquad-google__indexnow_submit'));
  assert.ok(st.permissions.allow.includes('mcp__aisquad-google__gsc_performance'));
  const k = kpi.readDefs(r.path);
  assert.deepEqual(k.map((x) => [x.id, x.source.kind, x.source.call || '', x.period, x.target]), [
    ['organic-clicks', 'google', 'gsc.performance', 'month', null], ['impressions', 'google', 'gsc.performance', 'month', null], ['top10-keywords', 'google', 'gsc.performance', 'month', null],
    ['organic-sessions', 'google', 'ga4.report', 'month', null], ['organic-key-events', 'google', 'ga4.report', 'month', null], ['ai-sessions', 'google', 'ga4.aiReferrals', 'month', null],
    ['ai-citations', 'manual', '', 'month', null], ['mobile-score', 'google', 'psi.run', 'week', null], ['pages-published', 'manual', '', 'month', null]]);
  assert.match(k[0].onBehind.task, /publish, submit and send nothing/);
  const routines = cadence.readDefs(r.path);
  assert.deepEqual(routines.map((x) => [x.id, x.every, x.enabled]), [['daily-content-draft', 'daily', false], ['gsc-anomaly', 'daily', false], ['weekly-report', 'weekly:mon', false], ['geo-panel', 'weekly:wed', false], ['technical-audit', 'monthly:1', false], ['decay-list', 'monthly:1', false], ['strategy-review', 'quarterly:1', false]]);
  assert.ok(routines.every((x) => x.at >= '22:00' || x.at < '05:00'), 'at night');
  assert.match(routines.find((x) => x.id === 'gsc-anomaly').task, /more than 20 %/);
  for (const s of ['seo-report', 'keyword-research', 'ai-visibility-audit', 'llms-txt', 'seo-audit']) assert.equal(skills.skillStatus(r.path, s).status, 'project', s);
  assert.match(fs.readFileSync(path.join(r.path, 'AISQUAD.md'), 'utf8'), /No paid SEO tool calls unless the owner has added and approved one/);
  // not connected yet: nothing is measured, and each card says what it needs
  const out = await kpi.tick(Date.now());
  assert.equal(out.filter((x) => x.floorId === r.id).length, 0, 'no failures every hour before Google is connected');
  const cards = kpi.list(r.id, r.path);
  assert.equal(cards.find((x) => x.id === 'organic-clicks').needs, 'the Google service account (Admin → Integrations → Google)');
  assert.equal(cards.find((x) => x.id === 'mobile-score').needs, 'the site address (Floor settings → Google)');
  assert.equal(cards.find((x) => x.id === 'pages-published').needs, undefined);
});
