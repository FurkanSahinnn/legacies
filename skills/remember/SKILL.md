---
name: remember
description: Save one durable project fact into legacies memory, linked to the code it concerns. The fact can be a decision and its reason, a gotcha ("X breaks if…"), a convention or a how-to. Use when the user says "bunu hatırla", "not al", "unutma", corrects you, or when you learn something a future session would otherwise have to rediscover.
---

# Remember: one fact, one note, tied to code

## Steps

1. Search first, so that you update a note instead of duplicating it:
   `legacies search "<key terms or identifiers>"`.
2. Pick the action:
   - **New fact:** create the note.

     ```bash
     legacies add --type <decision|gotcha|convention|howto|reference> \
       --title "<the claim itself, short>" --paths "<glob>,<glob>" --summary "<one line>" <<'EOF'
     Why it is true, where it lives (paths, symbols), and how to check it.
     EOF
     ```
   - **Existing note:** edit its file, then run `legacies verify <file>`.
   - **Wrong note:** set `status: superseded` in its frontmatter, add the new note, and mention the old one in it.
3. Pick where it lives:
   - A fact about this project goes into its own memory (the default).
   - A fact about another project you are working in goes into that project: add `--project "<its folder>"`.
   - A fact that ties several projects together goes into the workspace's shared memory: add `--workspace <name>`. Examples are an API contract between a web client and its mobile app, or a decision both must follow. `legacies workspace list` shows the workspaces.

## What makes a good note

- **The title is the claim.** Write "Rate limit is per user, not per IP", not "Rate limiting".
- **`paths`** list the files or globs the fact depends on. They let legacies flag the note as stale when that code changes.
- **One fact per note.** Keep the body to a few lines.
- **Durable facts only.** Leave out session chatter, progress updates and anything that belongs in the handoff card.
- **No secrets.** Never store tokens, keys or `.env` values.
