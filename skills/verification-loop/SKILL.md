---
name: verification-loop
description: Six-phase check of the current work (build, type check, lint, tests with coverage, a secret and console.log scan, diff review) ending in a PASS/FAIL report. Use after finishing a feature or refactor, before a PR, or when the user says "verify" or "run all checks". Not a code review.
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): skills/verification-loop/SKILL.md -->

# Verification Loop

A full verification pass over the work done in a Claude Code session.

## When to Use

Invoke this skill:
- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Before You Start

- **Use the project's real commands.** If the project has `.legacies/PROJECT.md`, its commands section (Komutlar) lists the exact build, test and lint commands; prefer them over the generic ones below. Otherwise read the `package.json` scripts and detect the package manager from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` / `bun.lock`, `package-lock.json`).
- **Never truncate output.** Do not pipe a phase through `head`, `tail` or `sed -n`: a cut-off log can hide the one line that failed. Each phase below tees its full output to a log file outside the repo. When the output is long, or the tool result is truncated, read the full log file (the Read tool; in Git Bash, `cygpath -w <path>` prints the Windows path) and search it for the failures instead of guessing.
- **One Bash call per phase.** Shell variables do not survive between Bash tool calls, so every snippet sets `LOG_DIR` again. If your environment gives you a session scratchpad directory, use it as `LOG_DIR` instead of the temp dir.

## Verification Phases

### Phase 1: Build Verification
```bash
set -o pipefail  # report the build's exit status, not tee's
LOG_DIR="${TMPDIR:-/tmp}/verification-loop"; mkdir -p "$LOG_DIR"
# Check if project builds
npm run build 2>&1 | tee "$LOG_DIR/build.log"
# OR
pnpm build 2>&1 | tee "$LOG_DIR/build.log"
```

If build fails, STOP and fix before continuing. For a stubborn build or type error, the project's build resolver subagent can make the minimal fix when the active host and a language pack provide one (`legacies-typescript:build-error-resolver`, `legacies-go:go-build-resolver` and the like).

### Phase 2: Type Check
```bash
set -o pipefail
LOG_DIR="${TMPDIR:-/tmp}/verification-loop"; mkdir -p "$LOG_DIR"
# TypeScript projects
npx --no-install tsc --noEmit 2>&1 | tee "$LOG_DIR/types.log"

# Python projects
pyright . 2>&1 | tee "$LOG_DIR/types.log"
```

Report all type errors. Fix critical ones before continuing.

### Phase 3: Lint Check
```bash
set -o pipefail
LOG_DIR="${TMPDIR:-/tmp}/verification-loop"; mkdir -p "$LOG_DIR"
# JavaScript/TypeScript
npm run lint 2>&1 | tee "$LOG_DIR/lint.log"

# Python
ruff check . 2>&1 | tee "$LOG_DIR/lint.log"
```

### Phase 4: Test Suite
```bash
set -o pipefail
LOG_DIR="${TMPDIR:-/tmp}/verification-loop"; mkdir -p "$LOG_DIR"
# Run tests with coverage
npm run test -- --coverage 2>&1 | tee "$LOG_DIR/test.log"

# Coverage: hold the project's own threshold (its test config or CI) when it has one
```

In a long test log, the summary and coverage table are at the end, but the failures can be anywhere: search the whole log for them rather than reading only the tail.

Report:
- Total tests: X
- Passed: X
- Failed: X
- Coverage: X%

### Phase 5: Security Scan
```bash
# git grep searches tracked and new files and skips ignored paths such as node_modules and .next
# Check for secrets
git grep -n --untracked -E 'sk-[A-Za-z0-9_-]{20,}' -- '*.ts' '*.tsx' '*.js'
git grep -n --untracked 'api_key' -- '*.ts' '*.tsx' '*.js'

# Check for console.log (whole repo, not just src/: Next.js apps often keep code in app/, components/, lib/)
git grep -n --untracked 'console.log' -- '*.ts' '*.tsx' ':(exclude)*.test.*' ':(exclude)*.spec.*'
```

Look at every hit: a literal key is a FAIL, while a read from `process.env` is fine. `git grep` exits with status 1 when nothing matches, which here is the good outcome.

### Phase 6: Diff Review
```bash
# Show what changed (git status also lists new files, which git diff does not)
git status --short
git diff --stat
git diff HEAD~1 --name-only
```

Review each changed file for:
- Unintended changes
- Missing error handling
- Potential edge cases

For a deeper review, hand the diff to an available reviewer subagent. Claude Code installations may provide `legacies:code-reviewer` and `legacies-security:security-reviewer`; Codex currently receives the review skills, so use its available reviewer agents with the same lanes.

## Output Format

After running all phases, produce a verification report. Write it in the user's language.

```
VERIFICATION REPORT
==================

Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage)
Security:  [PASS/FAIL] (X issues)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification every 15 minutes or after major changes. Set a mental checkpoint:

- After completing each function
- After finishing a component
- Before moving to the next task

Then run this skill again (`/legacies:verification-loop` in Claude Code, `$legacies:verification-loop` in Codex). Between full runs, the cheap phases (type check, lint, the affected tests) are enough; run all six before a PR.

## Integration with Hooks

This skill complements edit-time hooks (formatters, linters) but provides deeper verification. Hooks catch issues immediately; this skill provides a comprehensive review.

When the session ends or reaches a milestone, put the report's one-line result in the handoff card (`/legacies:handoff` in Claude Code, `$legacies:handoff` in Codex) so the next session knows what was verified.
