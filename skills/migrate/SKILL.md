---
name: migrate
description: Work through a migration between two projects with a tracked checklist. Ports pages, screens, API calls, components, hooks and services from a source project (for example a web client) to a target (for example its mobile app), or between versions of a codebase. Use when the user wants to port, migrate or re-implement features of one project in another, asks what is left of a migration, or says "taşı", "migrate et", "mobile'a geçir", "ne kaldı".
---

# Migrate: one checklist, ported item by item

A migration plan lives in a workspace's shared memory (`legacies workspace list`). Its checklist comes from the source project's routes, screens, API handlers, components, hooks, stores and services. Each item is matched to what already exists in the target. The inventory is a heuristic starting point, so judge every item before porting it.

## Start or resume

1. Look for an existing plan with `legacies migrate status`. If there is none, create one with `legacies migrate start <name> --from "<source project>" --to "<target project>"`. When the two projects share no workspace yet, a workspace named after the plan is created.
2. Make both projects readable in this session. Use `/add-dir "<other project>"`, or have the user start the session with `legacies open <workspace>`.
3. Read the workspace's shared notes for contracts and decisions: `legacies search "<topic>" --workspace <name>`.

## For each item

1. Take the next items with `legacies migrate next <name>`. Work in route order: whole screens first, then the pieces they pull in.
2. Read the source implementation and everything it depends on: data fetching, state, validation, side effects.
3. Find where the target keeps the same kind of code, and follow the target's conventions: navigation, styling, data layer, error handling. Do not copy web-only APIs (DOM, `window`, CSS-in-HTML) into a mobile or desktop target. Use the target platform's equivalent and name the replacement.
4. When the item has a target match marked "(adı eşleşiyor, kontrol et)", open it before writing anything. It may already be ported, or it may be unrelated code with the same name.
5. Verify in the target with its own typecheck, tests and lint.
6. Mark the item with `legacies migrate done <name> <item-id> --note "<what changed or was replaced>"`. Use `partial` with a note for half-done work, and `skip` with a reason for items that do not belong in the target (SEO pages, server-only code, desktop-only features).

## Keep the plan honest

- After the source changes or new files appear, run `legacies migrate refresh <name>`. Statuses and notes are kept.
- Some decisions apply to both projects, such as an API contract, a shared validation rule or a naming mapping. Save each one as a workspace note: `legacies add --workspace <name> --type decision --title "<claim>" --text "…"`.
- At the end of a session, write a card in each project you changed. The target's card goes in with `legacies handoff --project "<target>"`. The checklist itself is the migration's progress record.
