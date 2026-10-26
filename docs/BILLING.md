# Billing: subscription or API key

The AI Squad never handles your Claude credentials. It starts the official `claude` binary on your
machine, and that binary signs in the way you set it up: with your Claude subscription (Pro, Max,
Team, Enterprise) or with an API key from the Claude Console. Usage is billed to you by Anthropic
under your own agreement.

Policies changed several times in 2026. Check the official pages before you plan around them:

- Legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance>
- Manage costs: <https://code.claude.com/docs/en/costs>
- Agent SDK with your Claude plan: <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
- Monthly API credits for Max and Team: <https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans>

## What the official pages say (checked 26 Oct 2026)

- Pro and Max fall under the Consumer Terms; Team, Enterprise and the Claude API under the
  Commercial Terms.
- Signing in with a subscription (OAuth) is meant for ordinary use of Claude Code and Anthropic's
  own apps. The advertised Pro and Max usage limits assume ordinary, individual use of Claude Code
  and the Agent SDK.
- Developers building products or services, including with the Agent SDK, should use API key
  authentication. Third parties may not offer Claude.ai login in their own apps, route requests
  through Free, Pro or Max credentials on behalf of their users, or collect, store or intermediate
  Claude.ai credentials.
- A product may run the unmodified Claude Code binary, but each end user signs in with their own
  credentials and pays for their own usage; the product may not pay for, resell or intermediate it.
- Subscription seats have a rolling five-hour window and a weekly window. Agent teams use roughly
  seven times the tokens of a single session when teammates run in plan mode.
- Max and Team plans include monthly API credits (since 7 Oct 2026) that cover the Agent SDK and
  `claude -p` when they run with an API key of the linked Console organization.

This is a summary, not legal advice. When in doubt, ask Anthropic: <https://www.anthropic.com/contact-sales>.

## Auth modes in The AI Squad

Since 0.11.0, Building settings → **Claude sign-in** (`prefs.auth.mode` in `~/.aisquad/building.json`):

| Mode | Interactive agents (Desk, tmux) | Background runs (`claude -p`: audits, headless jobs) |
|---|---|---|
| `subscription` (default) | your `claude` login | your `claude` login |
| `api-key` | your `claude` login | `ANTHROPIC_API_KEY` from `~/.aisquad/secrets.json` (write-only in the UI) |

The key is passed only to background runs as an environment variable; it is never written to a
repository, a log or the browser.

## Recommendations

**For your own team (like Sopwer's own use):**

1. Interactive work (an owner or a team member at a Desk) signs in with that person's own plan.
2. Unattended work (night shifts, audits, scheduled jobs) runs in `api-key` mode with a key from a
   Console organization with a workspace spend limit; on Max or Team, link it to use the monthly
   API credits.
3. Do not run a fleet of always-on agents on one personal subscription.
4. Keep agent teams off unless the work is truly parallel; the dispatcher's slots are cheaper.

**For people who install The AI Squad from GitHub:**

- Bring your own credentials. The AI Squad never asks for, stores or forwards a Claude.ai login.
- Hosting The AI Squad for other people (a service where you pay for their Claude usage) is not
  covered by these modes; talk to Anthropic first.

## Spending less

- Short sessions: one session per task, closed when the task is done (context is re-read from files).
- The right model per role (Role Template `model`): Haiku for triage and routine, Sonnet for
  building, Opus for architecture and reviews.
- Work the server can do without a model (standups, routing, checks) stays without a model.
- Budgets per Floor (warning at 80 %, Attention at 100 %) and the Audit's cost per story point.
