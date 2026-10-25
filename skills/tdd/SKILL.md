---
name: tdd
description: "Test-driven development: write a failing test for one behaviour, make it pass with the simplest code, refactor, repeat. Use as a developer for logic, bug fixes and anything with acceptance criteria."
---
# Test-driven development

## The loop
1. **Red:** write one test for one behaviour from the acceptance criteria. Run it and see it fail for the right reason.
2. **Green:** write the simplest code that makes it pass. Run the whole relevant suite.
3. **Refactor:** clean names and duplication with the tests green. Commit.

## Guidelines
- Test behaviour through public interfaces, not private details.
- One acceptance criterion usually becomes one or more tests; name tests after the behaviour ("rejects an expired voucher").
- For a bug: first a test that reproduces it, then the fix. The test stays as the regression test.
- Keep tests fast and independent; use fakes for networks, clocks and external services.
- Use the project's own test runner and conventions (see `docs/TECH.md`); do not add a new framework without the lead.
- Never weaken or delete a test to make it pass. If a test is wrong, say why in the handoff.
