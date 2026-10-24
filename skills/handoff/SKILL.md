---
name: handoff
description: Write or update this session's handoff card in legacies memory, so that the next session, or this one after compaction, continues without rediscovering anything. Use at milestones, before finishing, when the legacies Stop reminder fires, or when the user says "devir kartı", "nerede kaldık yaz" or "oturumu kaydet".
---

# Handoff: leave the next session a short, exact card

Each session has one card. Running the command again rewrites it in place. The session id is picked up automatically.

If the session also changed another project, write that project's card into its own memory with `legacies handoff --project "<its folder>" <<'EOF' …`. The Stop reminder names each project that needs one.

```bash
legacies handoff <<'EOF'
## Hedef
What the user wants, in one or two sentences.

## Yapılanlar
- What changed, with evidence: file paths, commit hashes, test results.

## Kararlar
- The decision and why it was made, including the options that were rejected.

## Açık işler / riskler
- What is unfinished, broken or unverified.

## Sonraki adım
The exact next action: a command, or a file:line and what to do there.
EOF
```

## Rules

- **Size.** Keep the card under ~3000 characters. Write facts and evidence, not narrative.
- **STATE.md.** If the project's focus changed, update `.legacies/STATE.md` too.
- **Durable lessons.** A lesson that will matter after this task belongs in a note: use `/legacies:remember`.
- **Nothing worth keeping.** If the session produced nothing worth a card, such as a trivial change, run `legacies handoff --skip "<reason>"` instead.
- **Language.** Write in the user's language.
