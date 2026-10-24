---
name: code-map
description: Find where something lives in the code before grepping or reading files one by one. legacies maps symbols to file:line from the project's code graph and also matches file paths. Use when you need the location of a function, class, route or feature, want to know what calls or depends on something, or the user asks "bu nerede", "hangi dosyada", "neyi etkiler".
---

# Code map: locate first, read second

1. Run `legacies map "<identifier or topic>"` and use real code names where you know them, for example `createServerClient`, `RateLimiter` or `webhook route`.
   - It lists matching symbols as `name — file:Lline` from the graph, plus matching tracked files.
   - Plain words also match the words inside names: "send message" finds `sendMessage`.
   - Routes are listed by method and URL, for example `POST /api/chest/open — file:Lline`. Pages are listed as `sayfa /settings/privacy`. They are found from the words in their URL and in their handler: identifiers, error codes and table names.
   - Files are also matched by the words inside them (identifiers, error codes, comments), in any language, so describing what the code does works.
   - When the question is in another language than the code, translate it yourself before mapping. Run `legacies vocab` once per session: it lists the project's code words, the most used first. Pick the ones that match the question's meaning and run `legacies map` with them. `legacies vocab <word>...` shows which candidate words the project uses.
   - Turkish questions also use the project's own translation files (JSON, YAML, .po, .properties, Android XML, .strings, .resx). The `(Sözlük: ...)` line shows the code words they added.
   - This is cheap. Read only the lines it points to.
2. When you need relationships rather than locations, ask the graph. The graph is built by graphify, legacies' code-graph engine. Each command runs from the project root and its output is capped at about 2k characters:

   | Command | Answers |
   |---|---|
   | `legacies graph explain "<Name>"` | the symbol and its connections: where callers call it, and where its callees are defined |
   | `legacies graph path "<A>" "<B>"` | how two things connect |
   | `legacies graph affected "<Name>"` | what depends on it, up to three steps out, before you change it |
   | `legacies map "<question>" --deep` | the matches above plus their nearest callers and callees |

   - When several symbols share the name, the answer lists all of them with their lines and explains the best connected one. To pick another, ask again with `"path/to/file.ts::Name"`.
   - When nothing matches, fall back to normal search.
3. Graph status:
   - `legacies graph status` shows whether a graph exists and how far behind HEAD it is.
   - legacies builds the graph by itself when a project with memory has none. It refreshes the graph in the background after edits.
   - `legacies graph build` rebuilds it now. It parses the code locally and makes no LLM calls.

## Limits

- **Fallback:** Without a graph, only path matching works. Grep is still the fallback for string literals and config values.
- **Routing:** Routes and pages are known for the Next.js app and pages routers, SvelteKit and Expo Router. `'use client'` and server actions are not marked; grep for them.
- **Stale graph:** A graph that is several commits behind can point to moved code. When it matters, confirm the location by reading the file.
