# Contributing

Thank you for helping. The AI Squad is open source under the Apache License 2.0 and is
maintained by PT Sopwer Teknologi Indonesia.

## Ground rules

- Read `SPEC.md` first: it is the source of truth for scope, naming and file layout.
- English everywhere in code, file names, JSON keys, commit messages and docs. UI copy goes
  through `t('…')` and needs an Indonesian translation in `ui/i18n/id.json` ("kamu", no emoji).
- The server has **zero runtime dependencies** (`node:` built-ins only, Node.js 22 or newer).
- Every server module has unit tests (`node --test`). Run `npm test` before you open a pull request.
- Keep changes small and readable; match the style of the code around them.
- Every new source file starts with `// SPDX-License-Identifier: Apache-2.0`.

## Developer Certificate of Origin

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a
contributor license agreement. By signing off a commit you state that you wrote the change or
otherwise have the right to submit it under the Apache License 2.0:

```
git commit -s -m "feat(server): ..."
```

which adds `Signed-off-by: Your Name <you@example.com>` to the commit message. Pull requests
whose commits are not signed off cannot be merged.

## Commits and pull requests

- Conventional Commits: `feat(server): …`, `fix(ui): …`, `docs: …`, `chore: …`, `test: …`.
- One topic per pull request. Describe what changed, why, and how you verified it (tests, the
  playground, screenshots for UI changes).
- Do not commit secrets, `.env` files, personal data or absolute paths of your machine.

## Development

```
npm test                         # all tests, one module at a time
node scripts/seed-playground.js  # a scratch Building under ./playground
scripts/dev.sh start             # dev server on :8097 against the playground (PIN 123456)
```

See `README.md` (Develop) for the environment variables that point the server at scratch
directories and a fake Claude Code.

## Security

Please report vulnerabilities privately; see `SECURITY.md`.
