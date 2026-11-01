#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// aisquad-google (1.8): a small stdio MCP server for agents, shipped with the plugin, no dependencies. It holds no
// Google key: every tool asks the AI Squad server (POST $AISQUAD_URL/api/google/agent with the Space's agent token,
// $AISQUAD_SPACE_TOKEN), and the server makes the bounded Google call with the Owner's service account, for the
// properties in that Space's .claude/aisquad/google.json only. Read tools are marked readOnlyHint; indexnow_submit is
// the one write: the Space's settings make Claude Code ask the owner first, and automated runs ($AISQUAD_RUN) never
// get it. One JSON-RPC message per line on stdin and stdout; logs go to stderr.
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const url = String(process.env.AISQUAD_URL || '').replace(/\/$/, '');
const token = process.env.AISQUAD_SPACE_TOKEN || '';
const run = process.env.AISQUAD_RUN === 'desk' ? 'desk' : 'automated';
const dates = { from: { type: 'string', description: 'First day, YYYY-MM-DD (default: 28 days before "to")' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD (default: the last day with data; Search Console lags about 2 days)' } };
const READ = { readOnlyHint: true, openWorldHint: true };
export const TOOLS = [
  { name: 'gsc_performance', call: 'gsc.performance', annotations: { title: 'Search Console performance', ...READ }, description: 'Clicks, impressions, CTR and position from Google Search Console for this Space\'s site. Never invent a volume: these are real impressions.',
    inputSchema: { type: 'object', properties: { dimensions: { type: 'array', items: { enum: ['query', 'page', 'date', 'country', 'device'] } }, searchType: { enum: ['web', 'news', 'image', 'video', 'discover'] }, rowLimit: { type: 'integer', minimum: 1, maximum: 5000 }, minImpressions: { type: 'number' }, maxPosition: { type: 'number' }, ...dates } } },
  { name: 'gsc_inspect', call: 'gsc.inspect', annotations: { title: 'URL Inspection', ...READ }, description: 'Index status of up to 20 URLs of this Space\'s site (verdict, coverage, canonical, last crawl).',
    inputSchema: { type: 'object', required: ['urls'], properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 20 } } } },
  { name: 'ga4_report', call: 'ga4.report', annotations: { title: 'GA4 report', ...READ }, description: 'Sessions, engaged sessions, key events, conversions or users from GA4, by an allow-listed dimension, with one optional exact filter.',
    inputSchema: { type: 'object', properties: { metrics: { type: 'array', items: { enum: ['sessions', 'engagedSessions', 'keyEvents', 'conversions', 'totalUsers'] } }, dimensions: { type: 'array', items: { enum: ['date', 'sessionDefaultChannelGroup', 'sessionSource', 'landingPagePlusQueryString', 'country', 'deviceCategory'] } }, where: { type: 'object', description: 'One dimension and its exact value, e.g. {"sessionDefaultChannelGroup": "Organic Search"}' }, limit: { type: 'integer', minimum: 1, maximum: 1000 }, ...dates } } },
  { name: 'ga4_ai_referrals', call: 'ga4.aiReferrals', annotations: { title: 'Sessions from AI assistants', ...READ }, description: 'Sessions and key events from AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Claude, You.com, Phind), per assistant and in total.',
    inputSchema: { type: 'object', properties: { ...dates } } },
  { name: 'psi_run', call: 'psi.run', annotations: { title: 'PageSpeed Insights', ...READ }, description: 'Core Web Vitals (LCP, CLS, INP) and the performance score of a page; the site\'s home page by default.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, strategy: { enum: ['mobile', 'desktop'] } } } },
  { name: 'bing_stats', call: 'bing.stats', annotations: { title: 'Bing Webmaster stats', ...READ }, description: 'Query stats, page stats or crawl issues from Bing Webmaster Tools for this Space\'s site.',
    inputSchema: { type: 'object', properties: { report: { enum: ['queries', 'pages', 'crawl-issues'] } } } },
  { name: 'indexnow_submit', call: 'indexnow.submit', annotations: { title: 'Submit URLs to IndexNow (needs the owner\'s approval)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, description: 'Tell IndexNow (Bing and others) that up to 100 URLs of this Space\'s site changed. A write: only after the owner approved the published pages; never in automated runs.',
    inputSchema: { type: 'object', required: ['urls'], properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 100 } } } },
];

async function callTool(name, args) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  if (!url || !token) return { isError: true, content: [{ type: 'text', text: 'Not started by The AI Squad (AISQUAD_URL and AISQUAD_SPACE_TOKEN are missing): start the agent from its Space.' }] };
  if (t.call === 'indexnow.submit' && run !== 'desk') return { isError: true, content: [{ type: 'text', text: 'indexnow_submit is not allowed in automated runs: the owner approves it in a Desk session.' }] };
  try {
    const r = await fetch(`${url}/api/google/agent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aisquad-space': token }, body: JSON.stringify({ call: t.call, args: args || {}, run }), signal: AbortSignal.timeout(90e3) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { isError: true, content: [{ type: 'text', text: j.error || `The AI Squad server answered ${r.status}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(j) }], structuredContent: j };
  } catch (e) { return { isError: true, content: [{ type: 'text', text: `The AI Squad server did not answer: ${e.message}` }] }; }
}

const reply = (id, result, error) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })}\n`);
async function handle(m) {
  if (!m || typeof m !== 'object' || m.id === undefined) return;            // notifications need no answer
  if (m.method === 'initialize') return reply(m.id, { protocolVersion: VERSIONS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'aisquad-google', version: '1.8.0' } });
  if (m.method === 'ping') return reply(m.id, {});
  if (m.method === 'tools/list') return reply(m.id, { tools: TOOLS.map(({ call, ...t }) => t) });
  if (m.method === 'tools/call') return reply(m.id, await callTool(m.params?.name, m.params?.arguments));
  reply(m.id, null, { code: -32601, message: `Method not found: ${m.method}` });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {   // run, not imported (the tests read TOOLS)
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => { let m; try { m = JSON.parse(line); } catch { return; } handle(m).catch((e) => process.stderr.write(`[aisquad-google] ${e.message}\n`)); });
}
