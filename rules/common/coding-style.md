---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.py"
  - "**/*.cs"
  - "**/*.sql"
  - "**/supabase/**"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/common/coding-style.md, rules/common/code-review.md, rules/common/patterns.md, rules/common/security.md, skills/coding-standards/SKILL.md -->
# Coding style (all languages)

## Structure
- KISS and YAGNI: the simplest thing that works; no abstractions, options or features before a real need. Apply DRY once repetition is real, not speculative.
- Functions stay focused, roughly under 50 lines. Nesting stays at most 4 levels deep: use early returns and guard clauses.
- Source files: 200-400 lines is typical, 800 a soft ceiling (tests and generated files exempt). Group new code by feature or domain, not by file type.

## Names and comments
- Names say what a value holds or a function does (`marketSearchQuery`, not `q`). Functions are verb-noun (`fetchMarketData`, `isValidEmail`); booleans read as claims (`isLoading`, `hasError`, `canSubmit`).
- Name meaningful numbers: `MAX_RETRIES`, `DEBOUNCE_DELAY_MS`, not a bare `3` or `500`.
- Comments explain why (a constraint, a trade-off, a deliberate mutation), not what the code already says.
- No leftover debug output (`console.log`, `print`, `Console.WriteLine`); use the project's logger.

## Data and errors
- Prefer immutable updates: return new values instead of mutating inputs or shared state. Mutate only locally owned values, or on a measured hot path with a comment.
- Validate all external data (user input, request bodies, env, files, third-party responses) with a schema at the boundary. Fail fast with a clear message, then trust the types inside.
- Handle every error explicitly; never swallow one (empty `catch`, silent `return null`). Users get a helpful message with no stack trace, SQL or file path; the server log gets the full context. Patterns: `error-handling` skill (coding-standards pack).
- HTTP APIs: resource URLs with standard verbs (`PATCH` partial, `PUT` full update), one response shape across endpoints (reuse the existing one), paginated lists, and 400 with field-level details for validation failures.

## Data access
- Parameterized queries or a query builder only; never concatenate or interpolate input into SQL. Allowlist dynamic identifiers such as sort columns and operators.
- Select only the columns you use (no `SELECT *` or `select('*')` in app code), bound every list query with a limit or pagination, and avoid N+1 queries (join, embed or batch).
- Schema, indexes, RLS and migrations: the `postgres-patterns` and `database-migrations` skills (postgres and db-migrations packs).

## Security
- Authorize on the server for the specific record, not just "is logged in". Client-side checks only hide UI.
- Rate-limit auth and write endpoints. Cookie-authenticated state changes need CSRF protection (SameSite cookies or tokens).
- Never log secrets, tokens, cookies, auth headers, passwords or PII.
- Changes to auth or permissions, payments, crypto, raw SQL, or file paths and outbound URLs built from input go through the `security-review` skill checklist (security pack) before you call them done.
