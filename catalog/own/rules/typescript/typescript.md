---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
---
<!-- Adapted from ECC (MIT, Copyright (c) 2026 Affaan Mustafa): rules/typescript/coding-style.md, rules/typescript/patterns.md, rules/typescript/security.md, rules/react/patterns.md, rules/react/security.md, skills/coding-standards/SKILL.md -->
# TypeScript

## Types
- Exported functions, public methods and shared utilities declare parameter and return types; locals are inferred.
- `interface` for object shapes that get extended or implemented; `type` for unions, intersections, tuples, mapped and utility types. Name an inline object shape once it repeats.
- String-literal unions (`type Role = 'admin' | 'member'`) instead of `enum`, unless interop requires one.
- No `any`: type untrusted data as `unknown` and narrow it; use generics when the caller decides the type. Write `catch (error: unknown)` and narrow with `instanceof Error` before reading `.message`.
- Validate with Zod (`safeParse` at the boundary) and derive types from the schema (`z.infer<typeof Schema>`) instead of restating them.

## Values and async
- Immutable updates: spreads (`{ ...user, name }`, `[...items, item]`) and `Readonly<T>` parameters. `.sort()` and `.reverse()` mutate in place: copy first or use `toSorted()`.
- Start independent work together with `Promise.all`; await in sequence only when one result feeds the next.
- `fetch` does not reject on HTTP errors: check `response.ok` before parsing the body.

## Next.js server code
- Server Actions and route handlers are public endpoints. Validate input, authenticate and authorize inside each one; a check in the page or layout does not protect them.
- `NEXT_PUBLIC_*` values ship in the browser bundle: never put a secret behind that prefix.
- Modules holding secrets or privileged clients (database, Supabase service role) start with `import 'server-only'`, so a client import fails the build.
- Parse `process.env` once with a schema in a server module, so a missing variable fails at startup instead of mid-request.
