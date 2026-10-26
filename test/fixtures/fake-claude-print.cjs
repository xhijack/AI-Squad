#!/usr/bin/env node
// Fake `claude -p --output-format json`: answers with structured output for the squad recommendation.
// FAKE_CLAUDE_MODE=garbage prints something unreadable; the args are logged to $FAKE_CLAUDE_LOG.
const fs = require('fs');
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
if (process.env.FAKE_CLAUDE_MODE === 'garbage') { process.stdout.write('not json'); process.exit(1); }
if (process.env.FAKE_CLAUDE_MODE === 'audit') {
  const change = (o) => ({ summary: '', addRules: [], removeRules: [], appendPrompt: '', model: '', effort: '', setting: '', value: '', ...o });
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '', total_cost_usd: 0.0123, usage: { input_tokens: 3000, output_tokens: 400 }, modelUsage: { 'claude-haiku-5-5': {} }, structured_output: {
    summary: 'QA caught a bad module; the developer re-read files a lot.',
    findings: [
      { area: 'efficiency', severity: 'medium', title: 'Repeated reads', evidence: ['metric:efficiency.repeatedReads', 'E2'], recommendation: 'Keep notes of files already read.', target: { kind: 'role-template', id: 'fullstack-developer', proposedChange: change({ summary: 'Read each file once', addRules: ['Read a file once per task; keep notes instead of re-reading it.'] }) } },
      { area: 'process', severity: 'high', title: 'QA failed round 1', evidence: ['E1'], recommendation: 'Run the acceptance criteria before the handoff.', target: { kind: 'none', id: '', proposedChange: change({}) } },
    ] } }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({ type: 'result', result: '', structured_output: {
  blueprint: 'software-house', name: 'Resto POS', goal: 'A point of sale for my restaurant.',
  team: [{ template: 'fullstack-developer', count: 3, reason: 'Three modules can run in parallel: orders, kitchen, payments.' }, { template: 'qa-engineer', count: 1, reason: 'Payments need careful testing.' }, { template: 'no-such-role', count: 1, reason: 'x' }],
} }));
