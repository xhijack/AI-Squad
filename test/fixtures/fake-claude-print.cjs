#!/usr/bin/env node
// Fake `claude -p --output-format json`: answers with structured output for the squad recommendation.
// FAKE_CLAUDE_MODE=garbage prints something unreadable; the args are logged to $FAKE_CLAUDE_LOG.
const fs = require('fs');
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
if (process.env.FAKE_CLAUDE_MODE === 'garbage') { process.stdout.write('not json'); process.exit(1); }
process.stdout.write(JSON.stringify({ type: 'result', result: '', structured_output: {
  blueprint: 'software-house', name: 'Resto POS', goal: 'A point of sale for my restaurant.',
  team: [{ template: 'fullstack-developer', count: 3, reason: 'Three modules can run in parallel: orders, kitchen, payments.' }, { template: 'qa-engineer', count: 1, reason: 'Payments need careful testing.' }, { template: 'no-such-role', count: 1, reason: 'x' }],
} }));
