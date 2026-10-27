#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fake `claude -p --output-format stream-json`: reads the prompt on stdin, prints an init event, a tool call, a text
// reply and the result. FAKE_CLAUDE_MODE: fail (an error result, exit 1), budget (stopped at the budget), slow (waits
// before answering), quota (a rate-limit event first), commit (writes a file in its folder and commits it), handoff (a
// prompt "Handoff h-..." gets a done reply in the outbox; any other prompt writes $FAKE_CLAUDE_OUTBOX as a package).
// Args, the prompt and whether ANTHROPIC_API_KEY or an ERPNext key was set go to $FAKE_CLAUDE_LOG.
const fs = require('fs');
// `claude -p --output-format json --json-schema S PROMPT` (recommend, the Company Guide): the prompt is an argument,
// the answer is one JSON object shaped by the schema; nothing is read from stdin
const si = process.argv.indexOf('--json-schema');
if (si > 0) {
  const schema = JSON.parse(process.argv[si + 1] || '{}'), props = Object.keys(schema.properties || {}), prompt = process.argv.at(-1);
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt, structured: true }) + '\n');
  if (process.env.FAKE_CLAUDE_MODE === 'fail') { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Something broke' })); process.exit(1); }
  const out = props.includes('summary') ? { summary: `Fake summary for: ${prompt.slice(0, 60).replace(/\s+/g, ' ')}`, targets: [], materials: [{ space: 'marketing', item: 'A fake material the fake Claude suggested', why: 'fake' }] }
    : props.includes('blueprint') ? { blueprint: 'software-house', name: 'Fake squad', goal: 'Fake goal.', team: [{ template: 'project-manager', count: 1, reason: 'fake' }] } : {};
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(out), structured_output: out, total_cost_usd: 0.001 }));
  process.exit(0);
}
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_CLAUDE_MODE || '';
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt, apiKey: !!process.env.ANTHROPIC_API_KEY, erpKey: process.env.AISQUAD_ERP_KEY || '', cwd: process.cwd() }) + '\n');
  const sid = 'sess-' + Math.random().toString(16).slice(2, 10);
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const go = () => {
    out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-sonnet-5-5', tools: ['Read', 'Edit'] });
    if (mode === 'quota') out({ type: 'rate_limit_event', session_id: sid, rate_limits: { five_hour: { used_percentage: 91, resets_at: 1793050000 } } });
    out({ type: 'assistant', session_id: sid, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } });
    out({ type: 'assistant', session_id: sid, message: { content: [{ type: 'text', text: `Done: ${prompt.trim().slice(0, 40)}` }] } });
    if (mode === 'commit') {
      require('fs').writeFileSync(require('path').join(process.cwd(), `work-${sid}.txt`), prompt.slice(0, 200));
      require('child_process').execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: process.cwd() });
      require('child_process').execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `work ${sid}`], { cwd: process.cwd() });
    }
    if (mode === 'handoff') {
      const path = require('path'), dir = path.join(process.cwd(), 'docs', 'squad', 'handoffs', 'outbox');
      fs.mkdirSync(dir, { recursive: true });
      const m = prompt.match(/^Handoff (h-[\w-]+)/);
      if (m) fs.writeFileSync(path.join(dir, `${m[1]}-done.md`), `---\nreply-to: ${m[1]}\nkind: done\n---\nDone by the fake agent.\n`);
      else if (process.env.FAKE_CLAUDE_OUTBOX) fs.writeFileSync(path.join(dir, 'fake.md'), process.env.FAKE_CLAUDE_OUTBOX);
    }
    if (mode === 'fail') { out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Something broke', session_id: sid, total_cost_usd: 0.01, num_turns: 1 }); process.exit(1); }
    if (mode === 'budget') { out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: '', session_id: sid, total_cost_usd: 0.5, num_turns: 3 }); process.exit(1); }
    out({ type: 'result', subtype: 'success', is_error: false, result: `Done: ${prompt.trim().slice(0, 40)}`, session_id: sid, total_cost_usd: 0.0421, num_turns: 2, duration_ms: 1200, usage: { input_tokens: 900, output_tokens: 120 } });
    process.exit(0);
  };
  if (mode === 'slow') setTimeout(go, 30000); else go();
});
