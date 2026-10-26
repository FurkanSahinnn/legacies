# Third-party notices

## ECC

https://github.com/affaan-m/ECC

The following legacies files are adapted from ECC. Each one names its ECC source file in an HTML comment right after its frontmatter.

- **Core skills** (`skills/`): tdd-workflow, verification-loop, search-first.
- **Workflow skills** (`skills/`), adapted from ECC commands: `plan` (from `commands/plan.md`), `review-pr` (from `commands/review-pr.md`).
- **Core agents** (`agents/`): code-reviewer, silent-failure-hunter, type-design-analyzer.
- **Core rules** (`rules/`): common/core, common/coding-style, common/testing.
- **Pack content legacies adapted itself** (`catalog/own/`, built into `packs/` unchanged apart from plugin names):
  - Skills: security-review (including `cloud-infrastructure-security.md`), react-performance, react-patterns, react-testing, e2e-testing, postgres-patterns, database-migrations, error-handling.
  - Agents: build-error-resolver, csharp-reviewer, database-reviewer, python-reviewer, react-reviewer, security-reviewer, typescript-reviewer.
  - Rules: typescript/typescript, react/react, react/testing, web/web, python/python, csharp/csharp.

ECC is distributed under this license:

```
MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Technology packs (`packs/`)

Content under `catalog/original/` was written for legacies and is covered by legacies' own MIT license; it copies no third-party text. Its skills end with a comment listing the official documentation they were checked against.

`scripts/build-packs.mjs` generates every pack under `packs/` from an ECC checkout and from legacies' own content. The ECC commit is pinned in `catalog/registry.json`. Each generated skill, agent, rule and command names its ECC source file in an HTML comment right after its frontmatter.

legacies makes these changes:
- trims the frontmatter;
- removes ECC's prompt-defense preamble from agents;
- escapes skill argument tokens;
- applies the reviewed find-and-replace fixes in `catalog/patches.json`;
- uses the hand-written replacements in `catalog/overrides/` where they exist.

Most pack content is MIT, under the ECC license above.

The `sector-supply-chain` pack holds eight skills that ECC distributes under the Apache License 2.0 (author: evos):
- carrier-relationship-management
- customs-trade-compliance
- energy-procurement
- inventory-demand-planning
- logistics-exception-management
- production-scheduling
- quality-nonconformance
- returns-reverse-logistics

That pack ships the license text as `LICENSE-Apache-2.0.txt`. Its `NOTICE` file lists the files and the changes.

The `cpp` pack's `cpp-coding-standards` skill refers to rules of the C++ Core Guidelines (https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) by their IDs only. The guidelines' license allows personal and internal use only, so the rule titles are rewritten in legacies' own words (`catalog/overrides/`).

#### Original upstreams of pack content

ECC took a few skills from other projects. Each of these upstreams is distributed under the MIT License, and the permission notice above applies with the named copyright holder. The affected files carry an `<!-- Upstream: … -->` line under their ECC attribution.

- **Angular `angular-developer` skill**, https://github.com/angular/angular/tree/main/skills/dev-skills/angular-developer. Copyright (c) 2010-2026 Google LLC. Used in the `angular` pack's `angular-developer` skill, including its `references/` files.
- **hermescheck** by Huang Richao, https://github.com/huangrichao2020/hermescheck. Copyright (c) 2026 Huang Richao. It is the origin of the `ai-agents` pack's `agent-architecture-audit` skill.
- **infinite-agentic-loop**, https://github.com/disler/infinite-agentic-loop. Copyright (c) 2026 disler; the license is stated in its README.
- **continuous-claude**, https://github.com/AnandChowdhary/continuous-claude. Copyright (c) 2025 Anand Chowdhary.
- **ralphinho**, https://github.com/enitrat/ralphinho. Copyright (c) 2026 William Cory.

The `agent-workflows` pack's `autonomous-loops` skill describes patterns from the last three.

legacies does not bundle the process-methodology plugins it may suggest, such as superpowers. Claude Code installs them from their own marketplaces under their own licenses. legacies' own process skills adapt content from addyosmani/agent-skills; see the next section.

### Upstream sources credited inside ECC

- **Vercel Labs, `react-best-practices` skill** (MIT License, Copyright (c) Vercel), https://github.com/vercel-labs/agent-skills. The `react-performance` skill is derived from it through ECC. The MIT permission notice above applies with Vercel as copyright holder.
- **Supabase Agent Skills, `supabase-postgres-best-practices` skill** (MIT License, Copyright (c) 2026 Supabase), https://github.com/supabase/agent-skills. The license was checked in the repository's `LICENSE` and the skill's frontmatter at commit c9be0e931b7930f7d02126d04774d904c381e7d7. The `postgres-patterns` skill and the `database-reviewer` agent incorporate its patterns through ECC. The MIT permission notice above applies with Supabase as copyright holder.

## agent-skills

https://github.com/addyosmani/agent-skills (commit aeac41d4d005999432bb7312f7ff06383a91d59d)

legacies' process skills are adapted from agent-skills. Each file names its agent-skills source in an HTML comment right after its frontmatter; files that also keep ECC material name both.

- **Core skills** (`skills/`):
  - `tdd-workflow`: from `skills/test-driven-development` and `skills/incremental-implementation`.
  - `debugging`: from `skills/debugging-and-error-recovery`.
  - `spec`: from `skills/spec-driven-development` and `skills/interview-me`.
  - `plan`: the task breakdown, from `skills/planning-and-task-breakdown`.
  - `search-first`: the official-docs section, from `skills/source-driven-development`.
- **Core agent** (`agents/`): `code-reviewer`, the review additions from `skills/code-review-and-quality`.
- **Eval cases** (`evals/`): `tdd-fires-on-pasted-bug` and `debugging-fires-on-diagnosis` adapt the prompts and graders of `evals/plugin/tdd-fires-on-pasted-bug` and `evals/plugin/tdd-stays-quiet-on-debug`.

agent-skills is distributed under this license:

```
MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## graphify (installed tool, not bundled)

legacies' setup installs graphify 0.9.93 (https://github.com/Graphify-Labs/graphify, PyPI package `graphifyy`) with uv into legacies' own data folder and runs it to build the code graph. No graphify code is copied into this repository.

- **License:** Apache License 2.0; portions contributed before graphify's relicensing remain under the MIT License. The license texts ship with the installed package.
- **Copyright:** Copyright 2026 Safi Shamsi and the Graphify contributors.
- **What legacies uses:** the `extract . --code-only` and `update .` commands and the `graph.json` they write. legacies answers questions from that file itself; graphify's own installer, agent instruction files and hooks are never run.
- **Trademark and affiliation:** "graphify" is a mark of Graphify Labs. legacies is not affiliated with or endorsed by Graphify Labs.

## Ideas, no code copied

- **avenoxbeyin** (MIT, Copyright (c) 2026 Avenox), https://github.com/avenoxai/avenoxbeyin. Ideas taken:
  - Markdown files are the source of truth, and the index is disposable.
  - Context is packed into a budget with a minimum share per section.
  - Retrieved memory is labelled as data, not instructions.
  - Retrieval stays silent when nothing matches well.
  - A Stop hook blocks once until a work record is written.
  - Old records are archived verbatim instead of being summarised.
  - Secret patterns are scanned.
