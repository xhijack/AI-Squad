# Telegram notifications (0.15)

The AI Squad can send questions, permission prompts and alerts to Telegram and take your answer from there, so
a machine that runs all night does not wait for you to open a browser.

## Set up

1. In Telegram, talk to **@BotFather**: `/newbot`, pick a name, copy the token (`123456789:AA…`).
2. In The AI Squad: **Menu → Admin → Notifications**, paste the token, **Save token** (it is checked with Telegram's
   `getMe` and kept in `~/.aisquad/secrets.json`, mode 600; the browser only ever sees its last 4 characters).
3. **Pair a chat**: the page shows `/start 123456`. Send that to your bot within 10 minutes. Each person pairs their
   own chat with their own PIN, and acts from Telegram with their own role.
4. Tick **Send notifications** and save.

The bot uses long polling: the machine only makes outgoing HTTPS connections to `api.telegram.org`. No port is
opened and no public address is needed.

## What arrives

| Kind | When |
|---|---|
| Questions, permissions, waiting for a reply, crashes, scope changes, backup alerts | at once, with buttons |
| Machine alerts (RAM, swap, disk) | at once, also in quiet hours |
| Finished work, stalls, merges, budget | in the morning digest |

Quiet hours (default 22:00-07:00) hold everything but machine alerts; it is sent after. At most 20 messages an hour.
The digest (default 07:30) lists what still waits and what happened in the last 24 hours. Owner-only Spaces reach
only the Owner's chats.

## Buttons and commands

- An option button answers the dialog, exactly as the browser would. **Reply** asks for your text. **Dismiss**
  closes reports. **Open** links to the page when you set its address.
- **Hard stops** (money, legal, production deploys, secrets, irreversible actions) ask for a 4-digit code that the bot
  sends; anything else cancels.
- When the question is answered somewhere else, the buttons disappear.
- `/status`, `/chat <agent>` (then type; the agent's answer comes back), `/end`, `/digest`, `/help`.
- `/guide` (the Owner only, 1.7): the Company Guide, see below.

## The Company Guide on Telegram (1.7)

`/guide` in the Owner's chat runs the same interview as *Set up the company* in the app, one question per message:

- choices are buttons; where several fit (goals, what you have, divisions) the buttons are toggles and **Done**
  saves them (*Use the suggestion* for the divisions); a name, a sentence or a number is typed (`50`, `30.000.000`);
- **« Back** goes to the previous question with its answer shown, **Cancel** (or `/cancel`) stops; the answers are
  saved after every question, so `/guide` later offers *Continue* or *From the start*;
- the answers are the same file as the app's (`~/.aisquad/guide.json`): what you answered in the app is shown as
  *Now:* on Telegram, and the app's guide, when it is open, follows what you answer on Telegram;
- the language is your answer to the first question, else the Building's;
- at the end the bot sends the plan in plain words (the Spaces with their mode, targets, routines and what they need
  from you; what waits for you) and a link to `#/guide`. **Build happens only in the app**: it creates repositories
  and Spaces, which needs the PIN and a careful look.

Members and Viewers who send `/guide` get a polite "this is the Owner's".

## Spaces that send counts only (1.7)

A Space with *Telegram: Counts only* (Admin → Spaces; the Finance Blueprint sets it) sends no text, names, amounts
or answer buttons: a question from it arrives as "[Question] Finance · 1 item(s) from an Owner-only Space wait for
you" with only **Open**; the digest counts its items and leaves its targets out; `/chat` does not reach its agents.

## Privacy

Messages carry a short summary that goes through the same redaction as the Squad Log (secrets removed, e-mail
addresses and account numbers masked). Contract text, personal data and code stay in The AI Squad.
