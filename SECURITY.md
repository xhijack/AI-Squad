# Security

The AI Squad runs Claude Code agents on your own machine and gives them access to your project
folders. This page describes what protects you, what does not, and how to report a problem.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting (the repository's **Security** tab → **Report a
vulnerability**) with the steps to reproduce, the version (`/aisquad status` or `GET /api/version`)
and your operating system. Please do not open a public issue for a security problem. We aim to
answer within 3 working days and credit you in the release notes unless you prefer not.

## Threat model

| Asset | Threat | Protection |
|---|---|---|
| The server (`127.0.0.1:8097`) | Another program or website on the machine changes Floors or starts agents | Bound to loopback by default. Every change and every agent screen needs the local PIN (`~/.aisquad/pin`, mode 600, compared in constant time). A cross-site page cannot read the PIN, and the API never answers CORS preflights. |
| The server off loopback (`--host 0.0.0.0`) | Anyone on the network | Opt-in only. Then every API call, reads included, needs the PIN. Prefer a tunnel (SSH, Tailscale) over opening the port. |
| Secrets (ElevenLabs key, PIN, API keys) | Leaking into a repository, a log or the browser | Kept in `~/.aisquad/secrets.json` and `~/.aisquad/pin` (mode 600), never in a repository. The browser only sees "set ····abcd". Backups leave them out unless you ask for them, and then only in an encrypted backup. |
| Your repositories | An agent edits what it should not | Generated agent permissions can only be **stricter** than the Role Template. Agents are told never to read `.env` files and are started with `--disallowedTools` for them. Read-only linked repositories deny every write tool and git write. Destructive commands ask first on Squad Sprint Floors (edit locks hook). Merges are done by the server after the quality gate, never by an agent. Pushes follow the Floor's push policy (default: never). |
| The Squad Log and audits | Personal data or secrets in transcripts | Secrets are always redacted; personal data (e-mail, phone, NIK, account numbers) is masked by default. File contents and `.env` content are never logged. The audit export is anonymised and never uploaded. |
| Agent sessions | One agent's crash or memory leak takes the others down | Each agent has its own tmux server and its own systemd scope, so the out of memory killer takes one agent, not all. |
| tmux sockets | Another local user attaches to an agent | Sockets live in `/tmp/tmux-<uid>/`, which tmux creates for your user only. Do not run The AI Squad as root. |
| Design variants (agent-written HTML) | Script in a page the owner opens | Served in a sandboxed iframe with a strict Content-Security-Policy: no scripts, nothing from outside. |
| Backups | Someone reads a backup file | `aisquad backup` encrypts with AES-256-GCM (key from your passphrase via scrypt) when a passphrase is given. Unencrypted backups never contain secrets. |

## What is not protected

- **Agents are Claude Code sessions with the tools you allow.** A Role Template that allows `Bash`
  allows arbitrary commands inside the project folder. Review templates before you use them on
  production machines, keep `permissions.deny` strict, and keep the push policy at `never` unless
  you need otherwise.
- **The plugin runs code.** Like every Claude Code plugin, The AI Squad executes code on your
  machine (its server, its hooks). Install it only from a source you trust.
- **Prompt injection.** An agent that reads untrusted content (web pages, issues, customer
  e-mails) can be steered by it. The hard-stop list (money, legal, production deploys, secrets,
  irreversible actions, scope changes) always waits for the owner, whatever the Autopilot level.
- **Other users on a shared machine** who can read your home directory can read `~/.aisquad`.

## Hardening checklist

1. Keep the server on `127.0.0.1`; reach it remotely through SSH or Tailscale.
2. Run `aisquad doctor` after installing and after moving to a new machine.
3. Use encrypted backups (`aisquad backup --passphrase-env AISQUAD_BACKUP_PASSPHRASE`).
4. Keep Floors' push policy at `never` and merges behind a quality gate.
5. Give agents that read untrusted content the smallest set of tools.
