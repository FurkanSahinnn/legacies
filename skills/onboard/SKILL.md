---
name: onboard
description: Examine this project once and record it in its local legacies memory (.legacies/) — the project card, current state and first notes — so later sessions start with context instead of re-exploring. Use when the user asks to onboard the project ("hafızayı kur", "projeyi tanı", "onboard et") or agrees after legacies reports that the project has no memory yet. Also use to refresh a stale project card.
---

# Onboard: learn the project once, write it down

After this, a fresh session should understand the project from `.legacies/` alone, without re-reading the codebase.

## Steps

1. Run `legacies init`. It is idempotent: it creates `.legacies/` and hides it through `.git/info/exclude`, so no tracked file changes.
2. Read what already exists, cheapest first:
   - README files, CLAUDE.md, AGENTS.md, the index pages under docs/
   - the manifest and configs: package.json, tsconfig paths, framework config, supabase/ or migrations, pyproject, *.csproj
   - a two-level listing of the source tree

   If `.legacies/PROJECT.md` is already filled, refresh the parts that changed instead of rewriting it.
3. Map the architecture with a few targeted reads: entry points, routing, data access, auth, background jobs, and external services. In a large repo, delegate the sweep to an explore subagent and keep only its conclusions.
4. Write `.legacies/PROJECT.md`, at most ~150 lines. Remove the template marker line and fill these sections:
   - Amaç
   - Stack
   - Komutlar: the exact dev, test, build and lint commands
   - Mimari harita: folder → responsibility → key files
   - Önemli akışlar
   - Kurallar ve konvansiyonlar
   - Tuzaklar

   Then run `legacies verify PROJECT.md`.
5. Record 3–10 durable facts with `legacies add`: decisions with their reason, gotchas, and conventions. Every note gets `--paths` pointing at the code it describes.
6. Write `.legacies/STATE.md` with the current focus and open work. If unknown, ask the user in one question or leave the sections empty.
7. Code graph. Run `legacies graph build --background`, so the graph is ready without waiting for the next session.
   - It parses the code locally with graphify (no LLM calls) and writes it under `.legacies/graph/`.
   - If it reports that graphify is not installed, tell the user to run `legacies setup` in this project.
8. Report the files written, with one line each.

## Rules

- Write only what you verified in the code. Mark guesses as `doğrulanmadı`.
- Point to paths and symbols instead of pasting code.
- Never store secrets, tokens or `.env` values in memory.
- Do not edit tracked files such as CLAUDE.md, AGENTS.md or .gitignore. If CLAUDE.md is bloated, suggest moving parts into notes and ask first.

## Example note

```bash
legacies add --type gotcha --title "Server components must use createServerClient" \
  --paths "src/lib/supabase/**,src/middleware.ts" --summary "The browser client in an RSC drops the session" <<'EOF'
The browser client has no access to the request cookies, so in server components and
route handlers the user looks logged out. Use createServerClient from src/lib/supabase/server.ts.
Check it: render a protected page with the browser client, and auth.getUser() returns null.
EOF
```
