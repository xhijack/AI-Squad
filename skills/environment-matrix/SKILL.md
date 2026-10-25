---
name: environment-matrix
description: "Maintain docs/ENVIRONMENTS.md and .env.example: development, staging and production side by side (URLs, services, deploy, rollback) and every environment variable by name only. Use as DevOps whenever services or configuration change."
---
# Environment matrix

## docs/ENVIRONMENTS.md
1. A table with one column per environment (development, staging, production): URL, hosting, services (database, cache, queues, email), how to deploy, how to roll back, who can deploy.
2. An environment variable table: **name**, purpose, which environments need it, where the owner sets it. Never a value.
3. Differences between environments are explicit (for example "staging uses the sandbox payment gateway").

## .env.example
- Lists every variable the code reads, with a comment and **no value** (or an obviously fake placeholder).
- Keep it in the same order as the table; update both in the same commit as the code that needs a new variable.

## Check
- Search the code for variable reads (for example `process.env.`, `os.environ`, `getenv`) and compare with the table.
- Development and production never share databases, credentials or storage buckets.
