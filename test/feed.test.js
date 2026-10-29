// SPDX-License-Identifier: Apache-2.0
// Activity feed (1.2.0): grouping per agent, message text for "says", empty says hidden, plain words, expandable rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFeed, feedItem, feedHtml, feedKey } from '../ui/feed.js';

const T = Date.UTC(2026, 9, 28, 11, 21);
const feed = [
  { ts: T, kind: 'write', title: 'editing src/catalogue.css', detail: 'src/catalogue.css\n- a\n+ b', agentId: 'budi', agentName: 'Budi - Fullstack Developer' },
  { ts: T - 6e4, kind: 'think', title: 'says', detail: 'Catalogue grid is done.\nNext: the filters.', agentId: 'budi', agentName: 'Budi - Fullstack Developer' },
  { ts: T - 12e4, kind: 'think', title: 'says', detail: '   ', agentId: 'budi', agentName: 'Budi - Fullstack Developer' },
  { ts: T - 18e4, kind: 'test', title: 'running tests: Run checkout e2e', detail: 'npx playwright test checkout', agentId: 'sari', agentName: 'Sari - QA Engineer' },
  { ts: T - 24e4, kind: 'think', title: 'says', detail: '', agentId: 'budi', agentName: 'Budi - Fullstack Developer' },
  { ts: T - 30e4, kind: 'task', title: 'task from owner', detail: 'Build the product page', agentId: 'budi', agentName: 'Budi - Fullstack Developer' },
];

test('consecutive events of one agent form one group; empty "says" are hidden', () => {
  const g = groupFeed(feed);
  assert.deepEqual(g.map((x) => [x.agentName, x.items.length]), [['Budi', 2], ['Sari', 1], ['Budi', 1]]);
});

test('"says" shows the first line of the message; tools in plain words with their detail', () => {
  assert.equal(feedItem(feed[1]).text, 'Catalogue grid is done.');
  assert.equal(feedItem(feed[1]).more, 'Catalogue grid is done.\nNext: the filters.');
  assert.equal(feedItem(feed[2]), null);
  assert.equal(feedItem(feed[0]).text, 'Edited catalogue.css');
  assert.equal(feedItem(feed[0]).extra, '');                       // the path again adds nothing
  assert.equal(feedItem(feed[3]).text, 'Ran the tests');
  assert.equal(feedItem(feed[3]).extra, 'npx playwright test checkout');
  assert.equal(feedItem(feed[5]).extra, 'Build the product page');
});

test('rows are buttons that expand; an expanded row shows the full text', () => {
  const html = feedHtml(feed);
  assert.equal(html.match(/<section class="fgroup">/g).length, 3);
  assert.equal(html.match(/data-act="feed-toggle"/g).length, 4);
  assert.doesNotMatch(html, /class="fmore"/);
  const open = feedHtml(feed, new Set([feedKey(feed[1])]));
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<pre class="fmore">Catalogue grid is done.\nNext: the filters.<\/pre>/);
  assert.match(feedHtml([]), /No activity yet/);
});
