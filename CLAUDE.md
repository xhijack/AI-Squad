# The AI Squad

Read `SPEC.md` first: it is the source of truth for scope, naming, and file layout.

## Conventions

- **English everywhere**: UI copy, identifiers, file names, JSON keys, commit messages, docs. (Chat with the product owner may be Indonesian.)
- Node.js ≥ 22, **zero runtime dependencies** for the server (`node:` built-ins only). UI is plain HTML + ES modules; three.js `0.160.0` from jsDelivr via import map.
- Keep code small and readable; match the style of the reference implementations listed in `SPEC.md`.
- Dev server port **8097** (`node server/index.js --port 8097`). Do not touch ports used by other services (3000-3244, 5432, 6379-6380, 8000-8099 except 8097, 9000, 9010).
- Do not modify the reference implementations or any other project on this machine. Use a scratch Floor under `/tmp` or `./playground/` for tests.
- Tests: `node --test` (built-in runner). Every server module gets unit tests.
- Git: commit in small steps with Conventional Commits (`feat(server): ...`). **No AI attribution** (no Co-Authored-By, no "Generated with"). Never push.
- Machine is shared and resource-limited (15 GB RAM, limited disk): no heavy installs, no Docker, no parallel heavy jobs.
