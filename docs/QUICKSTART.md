# Quickstart

The AI Squad runs on your own machine (Linux, macOS or WSL) and drives Claude Code agents. A clean install takes a
few minutes.

## 1. What you need

- Node.js 22 or newer, git and tmux
- Claude Code, signed in: `curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` once
  ([setup guide](https://code.claude.com/docs/en/setup))
- A Claude plan that includes Claude Code, or an API key for background work (see [BILLING.md](BILLING.md))

## 2. One command

```
curl -fsSL https://raw.githubusercontent.com/xhijack/AI-Squad/main/install.sh | bash
```

It checks the machine (and says how to install what is missing), puts The AI Squad in `~/.aisquad-app`, links
`aisquad` into `~/.local/bin`, starts the server as a user service and opens `http://127.0.0.1:8097`. It prints your
PIN (changes need it; it is kept in `~/.aisquad/pin`). Nothing is installed with `sudo`.

With a first squad straight away:

```
curl -fsSL https://raw.githubusercontent.com/xhijack/AI-Squad/main/install.sh | bash -s -- --blueprint software-house --name "Clinic portal"
```

Blueprints: `software-house`, `erp-consultant`, `sales-crm`, `digital-marketing`, `legal` (Owner only).
Other branches: `AISQUAD_BRANCH=development` before `bash`.

## 3. First steps in the app

1. **Set up Squad**: describe what you want to build or run; pick a Blueprint and the team.
2. Open the Space and start its lead: it asks you for the source documents (PRD, BRD, brief…) first.
3. **Menu → Admin**: Spaces (kind, access, shift, machine, ERPNext), people and their PINs, Telegram, backups.
4. Optional: **Admin → Notifications** to answer agents from Telegram, **Admin → Machines** to add a worker machine.

## 4. As a Claude Code plugin

```
/plugin marketplace add xhijack/AI-Squad
/plugin install aisquad@aisquad
/aisquad
```

## 5. Update, stop, remove

```
bash ~/.aisquad-app/install.sh      # update to the newest version of the branch and restart
aisquad stop                        # stop the server (agents keep running in tmux)
aisquad uninstall                   # remove the service; ~/.aisquad and your Spaces stay
```

Back up before moving to another machine: `aisquad backup` (see the README, "Backups and moving to another machine").
