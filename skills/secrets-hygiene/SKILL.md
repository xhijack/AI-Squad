---
name: secrets-hygiene
description: "Keep secrets out of the repository, logs, chats and agent context: names only in docs, values set by the owner, and leaks reported at once. Use as DevOps, and by any agent touching configuration."
---
# Secrets hygiene

## Rules
- Never read, print, copy, commit or paste real secrets: `.env` files, keys, tokens, passwords, connection strings with passwords.
- Document variables by **name and purpose only** (`docs/ENVIRONMENTS.md`, `.env.example`).
- The owner sets real values in their own environment or secret store; ask them, do not ask for the value in chat.
- `.gitignore` covers `.env`, `.env.*` (except `.env.example`), key files and local config with secrets.
- Logs, error messages, screenshots and test fixtures contain no secrets or personal data.

## Check before a commit
1. `git diff --cached` contains no key-like strings (long random tokens, `-----BEGIN`, `password=`, `sk-`, `AKIA`).
2. New config files are either in `.gitignore` or contain only names and placeholders.

## If a secret leaked
Stop, tell the lead and the owner right away which secret and where; it must be rotated. Do not try to rewrite history yourself.
