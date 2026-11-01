// SPDX-License-Identifier: Apache-2.0
// The SEO & GEO skills (1.8): adapted from OpenSEO's MIT agent skills, with the attribution and the license notice in
// each, short (at most 120 lines) and in the standard format, naming only free sources: the aisquad-google tools that
// exist, WebSearch / WebFetch and the site's repository; never an OpenSEO or DataForSEO tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../server/frontmatter.js';
import * as g from '../server/google.js';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const NEW = ['keyword-research', 'keyword-clustering', 'content-brief', 'content-refresh', 'ai-visibility-audit', 'llms-txt', 'local-seo', 'seo-report'];
const ALL = [...NEW, 'seo-audit'];
// tools of OpenSEO's MCP server and of DataForSEO's: none may be named
const FOREIGN = /\b(research_keywords|get_keyword_metrics|get_ranked_keywords|get_search_console_performance|get_serp_results|save_keywords|list_saved_keywords|run_site_audit|get_project_context|update_project_context|list_projects|explore_prompt|research_ai_visibility_prompts|get_ai_visibility_\w+|save_ai_visibility_tracker|run_ai_visibility_check|estimate_ai_visibility_cost|search_local_businesses|get_local_serp_results|get_local_rank_grid|get_business_profile|get_business_reviews|get_backlinks_overview|dataforseo_\w+|serp_\w+_live|keywords_data_\w+|backlinks_\w+|on_page_\w+|mcp__(openseo|dataforseo)\w*)\b/;
const read = (s, f = 'SKILL.md') => fs.readFileSync(path.join(SKILLS, s, f), 'utf8');

test('every SEO skill is short, in the standard format, and says when to use it', () => {
  for (const s of ALL) {
    const text = read(s), { data, body } = parseFrontmatter(text);
    assert.equal(data.name, s);
    assert.ok(/Use /.test(data.description) && data.description.length > 60, `${s}: when to use it`);
    assert.match(body, /^# /);
    assert.ok(text.split('\n').length <= 120, `${s}: at most 120 lines`);
  }
  assert.equal(fs.readdirSync(SKILLS).filter((d) => d === 'seo-audit').length, 1, 'one seo-audit, merged');
});

test('attribution in each: the footer and the MIT notice', () => {
  for (const s of ALL) {
    assert.match(read(s), /OpenSEO[^\n]*\(MIT, every-app\/open-seo\)/, `${s}: footer`);
    const notice = read(s, 'LICENSE-NOTICE');
    assert.match(notice, /MIT License/);
    assert.match(notice, /Copyright \(c\) 2026 Ben Senescu/);
    assert.match(notice, /Permission is hereby granted, free of charge/);
  }
  assert.match(fs.readFileSync(path.join(SKILLS, '..', 'NOTICE'), 'utf8'), /OpenSEO.*every-app\/open-seo/s);
});

test('only free sources: no OpenSEO or DataForSEO tool, and every aisquad-google tool named exists', () => {
  const known = new Set(Object.keys(g.TOOLS));
  for (const s of ALL) {
    const text = read(s);
    assert.doesNotMatch(text, FOREIGN, `${s} names a paid or OpenSEO tool`);
    for (const m of text.matchAll(/`((?:gsc|ga4|psi|bing|indexnow)_\w+)`/g)) assert.ok(known.has(m[1]), `${s}: ${m[1]} is not an aisquad-google tool`);
    assert.match(text, /aisquad-google|WebSearch|WebFetch/, `${s} names its free sources`);
  }
  assert.doesNotMatch(read('ai-visibility-audit'), /indexnow_submit/, 'the GEO check never submits');
});
