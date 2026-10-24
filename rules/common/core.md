<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/common/development-workflow.md, rules/common/git-workflow.md, rules/common/code-review.md, rules/common/security.md, rules/common/testing.md -->
# Core rules

- **Verify before claiming done.** Run the project's own typecheck, lint, tests and build for what you changed, then read your diff. Report what ran, what failed and what you skipped; never call unrun code done or fixed. Full sequence: `verification-loop` skill.
- **No secrets in code.** Real API keys, tokens, passwords and connection strings come from env vars or a secret manager, never from source, tests, fixtures, logs or committed config. Fail fast when a required one is missing. If a secret was exposed, say so and recommend rotating it.
- **Prefer existing patterns.** Before adding a helper, component, dependency or convention, search the repo for one that already exists and follow it; local naming, structure and libraries win over these rules. When nothing fits, prefer a maintained library to hand-rolled code (`search-first` skill).
- **Small, focused changes.** Change only what the task needs: no drive-by refactors, renames, reformatting or speculative features. Call out anything you deliberately changed beyond the request.
- **Tests for behavior changes.** New behavior and bug fixes come with a test that fails without the change; for a bug, write that test first. Fix the code, not the test, unless the test is wrong. Workflow: `tdd-workflow` skill.

## Git
- Commit messages: `<type>: <description>`, type one of feat, fix, refactor, docs, test, chore, perf, ci (unless the repo uses its own convention); an optional body explains why.
- A pull request describes the whole branch (`git diff <base>...HEAD`, every commit, not just the last), includes a test plan, and goes to review only with CI green and conflicts resolved.
