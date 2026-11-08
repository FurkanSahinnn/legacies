---
name: tdd-workflow
description: Test-first build loop in thin slices. Write a failing test, watch it fail, make the smallest change that passes, refactor, verify each slice. Use when implementing logic, changing behavior or fixing a known bug, even when the code is pasted inline and tests aren't mentioned, or when the user says "TDD" or "önce test". To find out what broke, use debugging first.
---
<!-- Adapted from agent-skills (MIT, Copyright (c) 2025 Addy Osmani): skills/test-driven-development/SKILL.md, skills/incremental-implementation/SKILL.md -->
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): skills/tdd-workflow/SKILL.md -->

# TDD workflow: prove each slice with a test that failed first

Write a failing test before the code that makes it pass, and build in thin slices: one test, the smallest change that passes it, then the next slice. For a bug, reproduce it with a test before touching the code. Tests are the proof; "seems right" is not done.

**Not for** configuration, documentation or static content without behavior. To find out *what* broke, start with `debugging`, then come back here to fix it test-first.

## Before the first test

1. **Find the project's commands.** The Komutlar section of `.legacies/PROJECT.md` lists the test, build, lint and type-check commands; confirm them against the repo. Without it, read the build files and checked-in wrappers (`package.json` scripts, `./gradlew`, `./mvnw`, `make test`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`) and the CI config, which shows the commands that gate merges. Learn how to run one focused test and the full suite. Never assume `npm test`.
   - In JavaScript projects the lockfile names the package manager (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`) and `scripts.test` names the runner. They can differ: Bun may install while Jest or Vitest runs the tests.
2. **Follow the neighbors.** Use the location, file naming, framework and assertion style of the tests next to the code you change. `legacies search "<area> test"` may already record the conventions.
3. **State your assumptions** about requirements and scope when they aren't certain, as a short list the user can correct, before writing code. If the request and the code contradict each other, stop and ask which one wins.
4. **Starting from a plan** (a `.legacies/plans/` file or an approved plan-mode plan): turn each task's acceptance criteria into the behaviors to test, in the plan's order, without asking the user to restate them. The plan gives the intent; the RED/GREEN cycle gives the proof.

## The loop

```
RED ───────────────→ GREEN ─────────────→ REFACTOR ───→ next slice
write a test that    smallest change      clean up while
fails                that passes          the tests stay green
```

### RED: write a failing test

- One behavior per test, named for that behavior.
- Run it and watch it fail **for the reason you expect**: the assertion, not a typo, an import error or a missing fixture. A test that passes at once proves nothing; it may not test what you think.

### GREEN: the smallest change that passes

- Write only enough code to pass this test: no speculative options, no features that no test asks for yet.
- Run the focused test, then the tests around it.

### REFACTOR: clean up with the tests green

- Improve names, remove duplication, simplify. Behavior doesn't change, so the tests don't either.
- Run the tests after each refactoring step.

## Bugs: the Prove-It pattern

1. Write a test that reproduces the bug and watch it fail; that confirms the bug.
2. Fix the cause. When the cause isn't known yet, find it with `debugging` first.
3. Watch the test pass, then run the full suite for regressions.

For a tricky bug, a subagent can write the reproduction test from the bug description alone, without seeing your idea of the fix. Confirm that it fails, then fix.

## Slices: build in thin, working increments

- **Vertical first.** One complete path through the stack (data, API and UI for one capability) per slice, not one whole layer after another.
- **Risk first.** When one part is uncertain, such as a new library or protocol, prove it in the first slice before building on it.
- **Contract first.** When two sides are built in parallel, slice 0 fixes the interface: types, schema or API contract.
- **Keep it working.** After each slice the project builds and its tests pass. More than ~100 lines without running the tests is a red flag.
- **Simplest thing that works.** Three similar lines beat a premature abstraction. Before finishing a slice, ask whether it could be done in fewer lines and whether every abstraction earns its place.
- **Scope discipline.** Touch only what the task needs. Don't clean up adjacent code, reorder imports, delete comments you don't understand or add features that "seem useful". Report what you noticed instead:

  ```
  NOTICED BUT NOT TOUCHING:
  - src/utils/format.ts has an unused import (unrelated to this task)
  ```
- **Checkpoint, don't commit.** When a slice is green, report it and continue. Commit only when the user asks, and then one logical change per commit.

## Writing good tests

**Shape of the suite.** Most tests are small and fast: pure logic, no I/O, milliseconds each. Fewer integration tests cross real boundaries (API, database, file system). End-to-end tests cover only the critical user flows.

**Test outcomes, not interactions.** Assert on results and visible state, not on which internal methods ran. Interaction-based tests break on every refactor even when behavior is unchanged.

**Prefer real code to test doubles,** in this order: real implementation, fake (an in-memory version), stub (canned data), mock (verifies calls). Mock only at boundaries that are slow, non-deterministic or have side effects: network, clock, randomness, third-party services, email.

**Arrange, act, assert,** with one concept per test:

```typescript
it('marks a task overdue once its deadline has passed', () => {
  // Arrange
  const task = createTask({ title: 'Report', deadline: new Date('2026-01-01') });

  // Act
  const result = checkOverdue(task, new Date('2026-01-02'));

  // Assert
  expect(result.isOverdue).toBe(true);
});
```

TypeScript is shown; the shape is the same in any language.

**DAMP over DRY in tests.** Each test should read as a complete specification on its own. Some repetition is fine when it saves the reader from chasing shared helpers.

## Anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Testing implementation details | Breaks on refactor while behavior is unchanged | Test inputs and outputs |
| Flaky tests (timing, order) | Erode trust in the suite | Deterministic assertions, isolated state; wait for a condition instead of sleeping |
| Testing framework or library code | Spends effort on someone else's code | Test your own code |
| Large snapshots nobody reviews | Break on any change, prove little | Snapshots only for stable serialized data |
| Shared mutable state between tests | Pass alone, fail together | Each test sets up its own state |
| Mocking everything | Green tests, broken production | Real, then fake, then stub, then mock |

## Rationalizations

| Thought | Reality |
|---|---|
| "I'll write the tests after the code works" | Tests written afterwards check what the code does, not what it should do. |
| "Too simple to test" | Simple code grows. The test documents the expected behavior. |
| "I tested it manually" | A manual check doesn't persist; the next change can break it unnoticed. |
| "It's just a prototype" | Prototypes become production code. |
| "Let me run the suite again to be sure" | A repeat run on unchanged code adds nothing. Run it again after the next edit. |

## Red flags

- Code without a test for its behavior
- A default test command used without checking what this repo runs
- A new test that passes on its first run
- "All tests pass" without a run in this session
- A bug fix without a reproduction test
- Tests skipped or disabled to get a green suite
- The same command run twice with no code change in between

## Done when

- [ ] Every new behavior has a test that was seen failing first
- [ ] Every bug fix has a reproduction test that failed before the fix
- [ ] The full suite passes with the repo's own command, run in this session
- [ ] No test was skipped or disabled
- [ ] The reply lists the tests added and their RED → GREEN results; at a milestone, the one-line result goes into the handoff card (`/legacies:handoff` in Claude Code, `$legacies:handoff` in Codex)

Before a PR, run the full check with `verification-loop`: build, types, lint, tests, secret scan and diff.
