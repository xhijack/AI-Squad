---
name: deploy-and-rollback
description: "Write and verify deploy and rollback steps per environment so anyone can ship or undo a release safely. Use as DevOps before the first release and whenever the deploy process changes."
---
# Deploy and rollback

## For each environment, in docs/ENVIRONMENTS.md
1. **Preconditions:** branch or tag, passing quality gate, migrations reviewed, variables set by the owner.
2. **Deploy steps:** numbered, copy-pasteable commands or CI actions, with the expected output of each.
3. **Smoke check:** the URLs and flows to check right after deploying.
4. **Rollback steps:** how to return to the previous version, including database migrations (down migrations or a restore point) and caches.
5. **Who** may deploy to that environment.

## Verify
- Run the deploy and the rollback on staging (or a local copy) at least once and note the date.
- Data migrations are backward compatible for at least one release, so a rollback does not lose data.
- Never deploy to production without the owner's go-ahead; never push or deploy from an agent unless the Floor's push policy allows it.
