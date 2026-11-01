# The Google connector

Built into the AI Squad server since 1.8. It reads free, official Google and Bing data for targets and for the
SEO & GEO agents, with no extra service to run and no paid data. The server makes every call; agents ask the server.

## What it can call

Calls are fixed and bounded: there is no free-form query.

| Call | API | Returns | Limits |
|---|---|---|---|
| `gsc.performance` | Search Console `searchanalytics.query` | clicks, impressions, CTR, position; by query, page, date, country or device; `searchType` web, news, image, video or discover; optional `minImpressions` / `maxPosition` filters | at most 5,000 rows, at most 16 months; ends at today − 2 |
| `gsc.inspect` | URL Inspection | verdict, coverage, indexing, robots, fetch, last crawl, the canonicals | at most 20 URLs per call |
| `ga4.report` | GA4 Data API `runReport` | metrics `sessions`, `engagedSessions`, `keyEvents`, `conversions`, `totalUsers`; dimensions `date`, `sessionDefaultChannelGroup`, `sessionSource`, `landingPagePlusQueryString`, `country`, `deviceCategory`; one exact filter (`where`) | at most 1,000 rows |
| `ga4.aiReferrals` | GA4 `runReport` | sessions and key events from AI assistants, per assistant and in total | the allow-list below |
| `psi.run` | PageSpeed Insights v5 | the performance score (0–100), LCP, CLS, INP (field data) | mobile or desktop; works without a key |
| `bing.stats` | Bing Webmaster | query stats, page stats or crawl issues | at most 1,000 rows; needs the Bing key |
| `indexnow.submit` | IndexNow | submits URLs of the Space's own site | **the only write**; at most 100 URLs; the key file must be on the site |

Every call: 10 s to connect, 30 s in all, replies over 2 MB refused, a 429 (rate limited) tried again twice with
backoff. Errors come in plain words, for example *"The service account has no access to sc-domain:example.com. In
Search Console open sc-domain:example.com → Settings → Users and permissions → Add user: …"*.

**AI assistants** (`ga4.aiReferrals`, kept in `server/google.js`): `chatgpt.com`, `chat.openai.com`, `perplexity.ai`,
`gemini.google.com`, `copilot.microsoft.com`, `claude.ai`, `you.com`, `phind.com`. A session source counts when it is
one of them or a subdomain (`www.perplexity.ai`); a look-alike (`notchatgpt.com`) does not.

## Set it up

### 1. A service account (once, by the Owner)
1. In [Google Cloud Console](https://console.cloud.google.com/) create a project (or pick one).
2. **APIs & Services → Library**: enable the **Google Search Console API** and the **Google Analytics Data API**.
   (PageSpeed Insights needs nothing; enable the *PageSpeed Insights API* only if you want a key for a higher quota.)
3. **IAM & Admin → Service accounts → Create service account**. No project roles are needed.
4. Open it → **Keys → Add key → Create new key → JSON**. A file downloads.
5. In The AI Squad: **Admin → Integrations → Google → Service account key**: upload that file. Only its e-mail
   (`…@….iam.gserviceaccount.com`) is shown from now on. Delete the downloaded file afterwards.

The key is stored in `~/.aisquad/secrets.json` (mode 600), entry `google.serviceAccount`. It never goes into a
repository, the Squad Log, `KPI.md`, the browser or an agent's environment. `/aisquad doctor` checks the file's mode.
The sign-in asks only for the read-only scopes `webmasters.readonly` and `analytics.readonly`; the token is kept in
memory until five minutes before it expires.

### 2. Give the service account read access
- **Search Console**: open the property → **Settings → Users and permissions → Add user** → the service account's
  e-mail, permission **Restricted** (reading is enough).
- **GA4**: **Admin → Property access management** (for the property) → **+ → Add users** → the e-mail, role **Viewer**.

### 3. Tell each Space which properties it reads
**Floor settings → Google** (the Owner's), saved in the Space's `.claude/aisquad/google.json` (committed; ids only):
- *Search Console site*: `sc-domain:example.com` (a domain property) or `https://www.example.com/` (a URL prefix, with
  the slash at the end);
- *GA4 property id*: the number in GA4 → Admin → Property details (not the `G-` measurement id);
- *Site*: the home page address, for PageSpeed, Bing and IndexNow;
- *IndexNow key*: see `docs/seo/INDEXNOW.md` in an SEO & GEO Space.

**Test** says for each whether the service account can read it, and how to grant access when it cannot. It is logged
as `google.tested`. An Owner-only Space may fall back to your own properties (Admin → Integrations → Google); a team
Space reads only its own (the same rule as the ERPNext keys).

### Optional keys
Admin → Integrations → Google: a **PageSpeed API key** (`google.psiKey`, raises the quota) and a **Bing Webmaster API
key** (`bing.apiKey`; Bing Webmaster Tools → Settings → API access). Both are write-only.

## Targets from Google
Admin → Targets → Source **from Google**: the call, its arguments (JSON, `{{from}}` / `{{to}}` for the period) and the
path of the number (`totals.clicks`, `count`, `total.sessions`, `score`), then **Try**. Measured like the other
sources (hourly tick, a new period, *Measure now*); `kpi.measured` and `kpi.failed` carry `call` and `property`, never
the key or the arguments.

Search Console data lags about 2 days, so a Search Console period ends at today − 2: in the first two days of a month
there is nothing to measure yet (the tick waits quietly, *Measure now* says why), and the target card says *measured up
to <date>*. Until a Space has its key and properties, its Google targets are not measured and their card says what is
missing.

## Agents: the `aisquad-google` MCP server
`bin/google-mcp.js`, shipped with the plugin, no dependencies. A Blueprint that asks for it (`mcp: [aisquad-google]`,
the SEO & GEO Blueprint) gets it in the Space's `.mcp.json` at Set up Squad:

```json
{ "mcpServers": { "aisquad-google": { "type": "stdio", "command": "node", "args": ["${AISQUAD_PLUGIN_ROOT}/bin/google-mcp.js"],
  "env": { "AISQUAD_URL": "${AISQUAD_URL}", "AISQUAD_SPACE_TOKEN": "${AISQUAD_SPACE_TOKEN}", "AISQUAD_RUN": "${AISQUAD_RUN:-desk}" } } } }
```

- Tools: `gsc_performance`, `gsc_inspect`, `ga4_report`, `ga4_ai_referrals`, `psi_run`, `bing_stats` (all
  `readOnlyHint: true`) and `indexnow_submit` (the write).
- It holds no key. It asks the AI Squad server (`POST /api/google/agent`) with the **Space's agent token**
  (`~/.aisquad/agent-tokens.json`, 0600; given to the Space's sessions as a hidden variable), and the server answers
  only with that Space's properties.
- `indexnow_submit`: the Space's `.claude/settings.json` puts it on **ask**, so on the Desk Claude Code asks you first;
  background runs (routines, a target's work, Autopilot's jobs) never get it (`--disallowedTools`), the tool refuses it
  outside the Desk, and the server refuses it too. Each submit is logged as `google.submitted`.
- A job sent to a worker machine does not get these tools (the server and its token are on the Head).

## Paid SEO data (future-proofing)
Nothing paid is shipped or configured. If you add one yourself (for example DataForSEO's own MCP server in a Space's
`.mcp.json`), Admin → Integrations guesses its kind as **SEO data** (`seo`; names such as `dataforseo`, `seo`, `serp`)
so a Blueprint may say `requires: mcp:seo`, and you can mark its tools **costs money**: such a tool is denied to every
background run of the Spaces that can reach it, asked for on the Desk (a rule given at session start), and never feeds
a target.
