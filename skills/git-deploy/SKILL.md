---
name: git-deploy
description: "Deploy a release to an already approved server environment: the server pulls a git tag with a read-only deploy key, runs migrations, a smoke test, and rolls back to the previous tag when something fails. Use as DevOps when the lead asks for a deploy to staging (production only with the owner's go-ahead)."
---
# Git deploy (tag based)

Only for an environment whose install plan the owner approved (`docs/ops/INSTALL-<env>-<host>.md`). Production needs the owner's explicit go-ahead for this release, every time.

## Before
1. The tag exists and points at a commit where the quality gate passed (`git tag -l`, CI result or the squad's gate).
2. Migrations in this release are reviewed and backward compatible for one release (a rollback must not lose data).
3. Write down the **current** tag on the server: that is the rollback target.

## Deploy
1. On the server, in our app folder: `git fetch --tags` (the remote uses the read-only deploy key), then `git checkout <tag>`.
2. Build and start only our project: `docker compose -p <app>-<env> build` and `docker compose -p <app>-<env> up -d` (or the app's own start command from the install plan).
3. Run the migrations the release notes name.
4. **Smoke test:** the health URL and the two or three flows listed in `docs/ENVIRONMENTS.md`; check our containers' logs for errors in the first minutes.

## Rollback (when the smoke test fails)
1. `git checkout <previous tag>`, rebuild and start our project again.
2. Run down migrations only if the release notes say they are safe; otherwise restore the data snapshot taken before the deploy.
3. Smoke test again.

## Never
- Push from the server or from an agent, or use a key with write access.
- Deploy a branch head instead of a tag.
- Change another app's files, containers or proxy configuration.

## Report
To the lead (or the owner): environment, tag deployed, migrations, smoke test result, whether you rolled back and why, and the time it took.
