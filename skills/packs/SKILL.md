---
name: packs
description: Show, suggest and turn on or off the technology packs of this project (language, framework, database, cloud and process skills, agents and rules), the official plugins that fit its stack, and the user's own skills. Use when the user asks which skills or packs this project has or needs, wants one added or removed, or says "paket", "hangi skill'ler kurulu", "bu projeye ne lazım", "şu skill'i ekle/kaldır".
---

# Packs: per-project skills, chosen with the user

Packs are separate plugins (`legacies-<pack>@legacies`) turned on per project; official plugins and the user's own skills (`<name>@legacies-personal`) work the same way.

1. Run `legacies packs suggest --json` in the project root. It lists what the project's files point to, each with the evidence (`package.json: next`, `go.mod`…) and whether it is already on. `legacies packs list --json` lists the whole catalog in groups.
2. Ask the user before changing anything. Offer the detected packs that are off with AskUserQuestion (multiSelect, at most 4 options per question; put the strongest evidence first and mention weak matches as such). Official plugins that bring MCP servers or hooks, or need a language server, get a one-line note on what they bring.
3. Apply only what the user picked: `legacies packs add <name...>` or `legacies packs remove <name...>`. Names are pack ids (`react`), official plugin names (`vercel`) or full ids (`prisma@claude-plugins-official`). Default scope is this machine only; add `--scope project` only when the user wants it shared with the team.
4. Tell the user to run `/reload-plugins` to load the change in this session.

The user's own skills join the catalog with `legacies catalog add <folder or git URL>`; after that they can be turned on here like a pack. The full-screen checklist is `legacies packs` in a terminal.
