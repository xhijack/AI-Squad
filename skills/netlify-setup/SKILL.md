---
name: netlify-setup
description: "Set up and deploy a site on Netlify with the Netlify CLI, using NETLIFY_AUTH_TOKEN from the environment: create or link the site, build settings, environment variable names, preview and staging deploys. Custom domains and DNS stay with the owner. Use as DevOps for static sites and frontends hosted on Netlify."
---
# Netlify setup

## Credentials
- The CLI reads `NETLIFY_AUTH_TOKEN` from the environment. Check it is set with `test -n "$NETLIFY_AUTH_TOKEN" && echo set` (never print it).
- If it is not set, ask the owner to export it in the environment the agent runs in. **Never ask for a token in chat**, never write it to a file, a commit or a log.

## Readiness (no changes)
- `npx netlify-cli --version` (or `netlify --version`), `netlify status`.
- From the repository: build command, publish directory, Node version, and the environment variable **names** the build needs (from `.env.example`).
- Write the result in `docs/ops/NETLIFY.md`: site name, build settings, variable names, which branch deploys where, and what the owner must provide.

## Setup (after the plan is approved)
1. Link an existing site with `netlify link`, or create one with `netlify sites:create --name <app>-staging` (only when the owner approved a new site).
2. Put the build settings in `netlify.toml` (build command, publish directory, Node version) so they live in the repository.
3. Set variables by name: `netlify env:set NAME "value"` only with values the owner sets themselves. You may list names with `netlify env:list` (values hidden).

## Deploys
- Preview: `netlify deploy --build` (draft URL) for every change worth checking.
- Staging: a dedicated staging site or branch deploy, as agreed in `docs/ops/NETLIFY.md`.
- Production (`netlify deploy --build --prod`): only with the owner's go-ahead for this release.
- Smoke test the deployed URL; roll back with a previous deploy (`netlify api restoreSiteDeploy` or the UI) if it fails.

## The owner's part
Custom domain, DNS records, TLS, the account and billing. Prepare the exact records they need and hand them over; do not change them.
