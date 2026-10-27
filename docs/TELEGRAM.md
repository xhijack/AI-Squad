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

## Privacy

Messages carry a short summary that goes through the same redaction as the Squad Log (secrets removed, e-mail
addresses and account numbers masked). Contract text, personal data and code stay in The AI Squad.
