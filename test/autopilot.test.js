import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ap from '../server/autopilot.js';

const critical = (t, o) => ap.classify(t, o).critical;

test('critical: the hard-stop list in English and Indonesian', () => {
  for (const t of ['What price should the premium plan have?', 'Berapa harga paket premium?', 'Hapus data tamu yang lama?', 'Deploy produksi sekarang?',
    'Should we deploy to production tonight?', 'Do we need consent for storing phone numbers (personal data)?', 'Force push the cleaned branch?',
    'Drop the legacy_orders table?', 'Where do I put the Stripe API key?', 'Should we add a loyalty program feature to the PRD scope?',
    'There is no PRD yet: should I write one?', 'Pakai Midtrans untuk pembayaran?', 'Setujui kontrak dengan vendor?', 'Rewrite the history of main to remove the big file?']) {
    assert.equal(critical(t), true, t);
  }
});

test('not critical: everyday product and engineering choices', () => {
  for (const t of ['Rename the "Save" button to "Save changes"?', 'Ganti label tombol jadi "Simpan"?', 'Use Vitest or Jest for unit tests?', 'Should the RSVP list be sorted by name or by date?',
    'Deploy to staging after QA?', 'Which icon for the guest list tab?', 'Pakai warna biru atau hijau untuk tombol utama?']) {
    assert.equal(critical(t), false, t);
  }
});

test('unclear questions count as critical; reasons name the hard-stop item', () => {
  assert.deepEqual(ap.classify(''), { critical: true, reasons: ['unclear'] });
  assert.deepEqual(ap.classify('Hapus data lama dan ubah harga?').reasons, ['money', 'irreversible']);
});

test('owner-only phrases of the Blueprint wait under balanced, not under full', () => {
  const o = { ownerOnly: ['launch date'] };
  assert.equal(critical('Move the launch date to Friday?', { ...o, level: 'balanced' }), true);
  assert.equal(critical('Move the launch date to Friday?', { ...o, level: 'full' }), false);
  assert.equal(critical('Delete the users table?', { ...o, level: 'full' }), true, 'the hard-stop list always waits');
});

test('the recommended option and settings', () => {
  const opts = [{ n: 1, label: 'Jest' }, { n: 2, label: 'Vitest (Recommended)' }, { n: 3, label: 'Type something', free: true }];
  assert.equal(ap.recommendedOption(opts).n, 2);
  assert.equal(ap.recommendedOption([{ n: 1, label: 'A' }, { n: 2, label: 'B' }]), null);
  assert.equal(ap.cleanLabel('Vitest (Recommended)'), 'Vitest');
  assert.deepEqual(ap.cleanSettings({}), { autopilot: 'off', autopilotTimeoutSec: 180 }, 'older Floors keep today\'s behaviour');
  assert.deepEqual(ap.cleanSettings({}, 'balanced'), { autopilot: 'balanced', autopilotTimeoutSec: 180 });
  assert.deepEqual(ap.cleanSettings({ autopilot: 'full', autopilotTimeoutSec: '5' }), { autopilot: 'full', autopilotTimeoutSec: 30 });
  assert.deepEqual(ap.cleanSettings({ autopilot: 'turbo' }, 'balanced').autopilot, 'balanced');
});

test('the timeout', () => {
  const now = Date.now();
  assert.equal(ap.due(now - 179e3, 180, now), false);
  assert.equal(ap.due(now - 180e3, 180, now), true);
  assert.equal(ap.due(0, 180, now), false);
});

test('lead rules carry the hard-stop list and the record mark; none when off', () => {
  assert.equal(ap.leadRules('off'), null);
  const r = ap.leadRules('balanced').join('\n');
  assert.match(r, /Autopilot is \*\*balanced\*\*/); assert.match(r, /DECIDED BY LEAD \(autopilot\), owner may correct/);
  for (const x of ap.hardStopList()) assert.ok(r.includes(x), x);
  assert.match(r, /owner-only/); assert.doesNotMatch(ap.leadRules('full').join('\n'), /owner-only/);
  assert.match(r, /within 3 minutes/);
});

test('idle nudge: after 5 minutes of everyone idle with open work, at most once per 15 minutes', () => {
  const s = {}, t0 = 1e12, MIN = 60e3;
  assert.equal(ap.idleNudgeDue({ allIdle: true, openWork: 2 }, s, t0), false);
  assert.equal(ap.idleNudgeDue({ allIdle: true, openWork: 2 }, s, t0 + 4 * MIN), false);
  assert.equal(ap.idleNudgeDue({ allIdle: true, openWork: 2 }, s, t0 + 5 * MIN), true);
  assert.equal(ap.idleNudgeDue({ allIdle: true, openWork: 2 }, s, t0 + 10 * MIN), false, 'rate limit');
  assert.equal(ap.idleNudgeDue({ allIdle: true, openWork: 2 }, s, t0 + 20 * MIN), true);
  assert.equal(ap.idleNudgeDue({ allIdle: false, openWork: 2 }, s, t0 + 21 * MIN), false);
  assert.equal(s.idleSince, 0, 'activity resets the idle clock');
  assert.equal(ap.idleNudgeDue({ allIdle: true, openWork: 0 }, s, t0 + 60 * MIN), false, 'no open work');
});

test('the chain stops for the budget, memory, a critical item or an empty backlog', () => {
  assert.equal(ap.chainStop({ level: 'balanced', openWork: 3 }), '');
  assert.equal(ap.chainStop({ level: 'off' }), 'Autopilot is off');
  assert.equal(ap.chainStop({ level: 'full', budgetOver: true }), 'budget reached');
  assert.match(ap.chainStop({ level: 'full', pressure: 'swap is 90 % full' }), /memory/);
  assert.equal(ap.chainStop({ level: 'balanced', criticalWaiting: 1 }), '1 critical item waits for the owner');
  assert.equal(ap.chainStop({ level: 'balanced', openWork: 0 }), 'the backlog is empty');
});

test('lead decisions are found in the questions file', () => {
  const md = '## 12. Sort order\nOptions: name, date\nChoice: date. DECIDED BY LEAD (autopilot), owner may correct\n\n## 13. Price\nOPEN';
  const d = ap.leadDecisions(md);
  assert.equal(d.length, 1); assert.match(d[0], /Sort order.*Choice: date/);
});
