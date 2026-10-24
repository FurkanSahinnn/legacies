import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, toPosix } from './util.mjs';

// Frontmatter keys each component keeps. ECC's metadata/origin, pinned models and license or author
// lines are dropped; the attribution comment carries the provenance instead.
const KEEP_KEYS = {
  skill: ['name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'allowed-tools', 'disable-model-invocation', 'user-invocable', 'paths'],
  agent: ['name', 'description', 'tools', 'color'],
  command: ['description', 'argument-hint', 'allowed-tools'],
  rule: ['paths', 'description'],
};
const CHANGES = {
  skill: 'frontmatter trimmed, argument tokens escaped',
  agent: 'frontmatter trimmed, prompt-defense preamble removed',
  command: 'frontmatter trimmed',
  rule: 'frontmatter trimmed',
};
const TARGET_DIR = { skill: 'skills', agent: 'agents', command: 'commands', rule: 'rules' };
const ATTRIBUTION_PREFIX = '<!-- Adapted from';
const ECC_MENTION = /\bECC\b|everything-claude-code|\/ecc[:-]|\.claude\/ecc|\bECC_[A-Z_]+/;
const ARGUMENT_TOKEN = /(?<!\\)\$(\d|ARGUMENTS\b)/;
const APACHE = 'Apache-2.0';
const CORE_PLUGIN = 'legacies';
const PACKS_DIR = 'packs';
// How documents name another component: `name` or `ns:name`, /name or /ns:name, "name skill|agent|…",
// **name** and [name](link). The plain and bold forms need a hyphen, so ordinary words such as
// "docs skill" or **Note** are never read as names.
const REFERENCE = /`\/?(?:[\w-]+:)?([a-z0-9][a-z0-9-]*)`|(?:^|[\s(])\/(?:[\w-]+:)?([a-z0-9][a-z0-9-]*)(?![\w/.-])|\b([a-z0-9]+(?:-[a-z0-9]+)+)\s+(?:skill|agent|subagent|command)s?\b|\*\*([a-z0-9]+(?:-[a-z0-9]+)+)\*\*|\[([a-z0-9][a-z0-9-]*)\]\(/g;
const PLUGIN_REFERENCE = /\blegacies:([a-z0-9][a-z0-9-]*)/g;

function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  return match ? { head: match[1], body: text.slice(match[0].length) } : { head: null, body: text };
}

// Keeps whole top-level entries: a key line plus the indented or list lines under it.
function keepEntries(head, keys) {
  let keeping = false;
  return head.split('\n').filter((line) => {
    const key = line.match(/^([A-Za-z_][\w-]*):/);
    if (key) keeping = keys.includes(key[1]);
    return keeping;
  }).join('\n');
}

function topLevelValue(head, key) {
  const value = head?.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))?.[1];
  return value ? value.trim().replace(/^["']|["']$/g, '') : null;
}

// ECC prefixes every agent with a generic prompt-injection checklist that costs about 1 KB per
// agent and says nothing about the agent's job.
export function stripPromptDefense(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s+Prompt Defense Baseline\s*$/.test(line));
  if (start < 0) return body;
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s*[-*]\s/.test(lines[end]))) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

// Skill bodies substitute $0, $1… with invocation arguments, which corrupts SQL placeholders and
// Swift closures in examples. A backslash keeps them literal, also inside code fences (checked live).
export function escapeArgumentTokens(body) {
  return body.replace(/(?<!\\)\$(\d)/g, '\\$$$1');
}

// Small upstream fixes are exact find/replace pairs. Each must match exactly once, so an upstream
// change that moves the text fails the build instead of shipping the old wording silently.
export function applyPatches(text, patches) {
  let result = text;
  const failures = [];
  for (const { find, replace } of patches) {
    const count = result.split(find).length - 1;
    if (count !== 1) {
      failures.push({ find: find.slice(0, 60), count });
      continue;
    }
    result = result.replace(find, () => replace);
  }
  return { text: result, failures };
}

// ECC's language rules link to ECC's common rules, which packs don't ship; rules are installed
// flat, so relative links would break anyway. legacies' own common rules cover the same ground.
const COMMON_RULE_REFERENCE = {
  'coding-style': 'the common coding-style rules',
  testing: 'the common testing rules',
  security: 'the security section of the common coding-style rules',
  patterns: 'the common coding-style rules',
  performance: 'the common coding-style rules',
};

function rewriteCommonRuleLinks(body) {
  return body.replace(/\[common\/([a-z-]+)\.md\]\(\.\.\/common\/\1\.md\)/g, (_, name) => COMMON_RULE_REFERENCE[name] || `the common ${name} rules`);
}

function attributionLine(kind, source, relPath, license) {
  if (license === source.license) return `${ATTRIBUTION_PREFIX} ${source.name} (${license}, ${source.copyright}): ${relPath} -->`;
  return `${ATTRIBUTION_PREFIX} ${source.name}: ${relPath} (${license}). Modified by legacies: ${CHANGES[kind]}. -->`;
}

// `upstream` credits whoever ECC took the content from; MIT asks for their notice to travel with it.
export function adapt(kind, text, { source, relPath, upstream = [] }) {
  const { head, body } = splitFrontmatter(text.replace(/\r\n/g, '\n'));
  const license = topLevelValue(head, 'license') || source.license;
  let content = kind === 'agent' ? stripPromptDefense(body) : body;
  if (kind === 'skill') content = escapeArgumentTokens(content);
  if (kind === 'rule') content = rewriteCommonRuleLinks(content);
  const frontmatter = head === null ? '' : `---\n${keepEntries(head, KEEP_KEYS[kind])}\n---\n`;
  const credits = [attributionLine(kind, source, relPath, license), ...upstream.map((line) => `<!-- Upstream: ${line} -->`)];
  return { text: `${frontmatter}${credits.join('\n')}\n${content.replace(/^\n{2,}/, '\n')}`, license };
}

function eccMentionLines(text) {
  return text.split('\n').flatMap((line, i) => (!line.startsWith(ATTRIBUTION_PREFIX) && ECC_MENTION.test(line) ? [i + 1] : []));
}

// A component a source defines but no pack and not the core ships: the model would go looking for
// something that is not installed. Only names a source really defines count.
export function findDanglingReferences(text, { vocabulary, shipped }) {
  const found = [];
  const seen = new Set();
  text.split('\n').forEach((line, i) => {
    if (line.startsWith(ATTRIBUTION_PREFIX)) return;
    for (const match of line.matchAll(REFERENCE)) {
      const name = match.slice(1).find(Boolean);
      const key = `${name}:${i}`;
      if (!vocabulary.has(name) || shipped.has(name) || seen.has(key)) continue;
      seen.add(key);
      found.push({ name, line: i + 1 });
    }
  });
  return found;
}

// Core content moved into a pack still says legacies:<name>; the plugin namespace is now the pack's.
function rewritePluginRefs(text, pluginOf) {
  return text.replace(PLUGIN_REFERENCE, (whole, name) => (pluginOf.has(name) ? `${pluginOf.get(name)}:${name}` : whole));
}

// The marketplace lists the core and one entry per pack; pack entries are regenerated on every build.
export function withPackEntries(marketplace, entries) {
  const kept = (marketplace.plugins || []).filter((p) => !String(p.source || '').startsWith(`./${PACKS_DIR}/`));
  return { ...marketplace, plugins: [...kept, ...entries] };
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [toPosix(path.relative(base, full))];
  });
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
}

// Where a member's content comes from: an override written by hand wins over the upstream copy.
function resolveMember(member, sourceRoots, overridesRoot) {
  const upstream = path.join(sourceRoots[member.source], member.path);
  const override = path.join(overridesRoot, member.source, member.path);
  const main = member.kind === 'skill' ? 'SKILL.md' : '';
  const overridden = fs.existsSync(path.join(override, main));
  return { upstream, override, overridden, mainFile: path.join(overridden ? override : upstream, main) };
}

function targetName(member) {
  if (member.kind === 'rule') return member.path.replace(/^rules\//, '').replace(/\//g, '-');
  return path.basename(member.path);
}

const memberName = (member) => targetName(member).replace(/\.md$/, '');

// Skill, agent and command names a plugin-shaped folder defines.
function componentNames(root) {
  if (!root) return [];
  const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []);
  const skills = entries(path.join(root, 'skills')).filter((e) => e.isDirectory()).map((e) => e.name);
  const files = ['agents', 'commands'].flatMap((dir) => entries(path.join(root, dir)).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.slice(0, -3)));
  return [...skills, ...files];
}

function noteDanglingReferences(text, file, ctx) {
  for (const ref of findDanglingReferences(text, ctx.names)) ctx.report.danglingReferences.push({ file, ...ref });
}

function readPatched(member, relPath, resolved, patches, report) {
  const key = `${member.source}/${relPath}`;
  const raw = fs.readFileSync(resolved.mainFile, 'utf8').replace(/\r\n/g, '\n');
  if (!patches[key]) return raw;
  const { text, failures } = applyPatches(raw, patches[key]);
  report.patched.push(key);
  report.patchFailures.push(...failures.map((failure) => ({ file: key, ...failure })));
  return text;
}

// Markdown is checked like the main file; scripts and other files are copied byte for byte and listed for review.
function copySupportingFiles(member, resolved, target, ctx) {
  const skipped = new Set(['SKILL.md', ...(member.skipFiles || [])]);
  for (const dir of [resolved.upstream, resolved.override]) {
    for (const file of listFiles(dir).filter((f) => !skipped.has(f))) {
      const dest = path.join(target, file);
      if (file.endsWith('.md')) {
        const text = rewritePluginRefs(fs.readFileSync(path.join(dir, file), 'utf8'), ctx.pluginOf);
        writeFile(dest, text);
        noteDanglingReferences(text, ctx.rel(dest), ctx);
        continue;
      }
      writeFile(dest, fs.readFileSync(path.join(dir, file)));
      if (!ctx.report.scripts.includes(ctx.rel(dest))) ctx.report.scripts.push(ctx.rel(dest));
    }
  }
}

function writeMember(member, resolved, packDir, source, ctx) {
  const { report } = ctx;
  const target = path.join(packDir, TARGET_DIR[member.kind], targetName(member));
  const relPath = member.kind === 'skill' ? `${member.path}/SKILL.md` : member.path;
  const raw = readPatched(member, relPath, resolved, ctx.patches, report);
  // A verbatim source holds content legacies wrote or already adapted; adapting it twice would double
  // the credits. Escaping argument tokens is idempotent, so its skills get that step too.
  const verbatimText = member.kind === 'skill' ? escapeArgumentTokens(raw) : raw;
  const adapted = source.verbatim ? { text: verbatimText, license: member.license || source.license } : adapt(member.kind, raw, { source, relPath, upstream: member.upstream });
  const text = rewritePluginRefs(adapted.text, ctx.pluginOf);
  const mainTarget = member.kind === 'skill' ? path.join(target, 'SKILL.md') : target;
  writeFile(mainTarget, text);
  const mentions = eccMentionLines(text);
  if (mentions.length) report.mentions.push({ file: ctx.rel(mainTarget), lines: mentions });
  if (member.kind === 'command' && ARGUMENT_TOKEN.test(text)) report.commandTokens.push(ctx.rel(mainTarget));
  noteDanglingReferences(text, ctx.rel(mainTarget), ctx);
  if (member.kind === 'skill') copySupportingFiles(member, resolved, target, ctx);
  return { kind: member.kind, name: memberName(member), from: `${member.source}/${relPath}`, license: adapted.license };
}

// Credits what the pack was adapted from; content written for legacies (`original` sources) credits no one.
function packDescription(packId, written, sources) {
  const count = (kind, label) => {
    const n = written.filter((w) => w.kind === kind).length;
    return n ? `${n} ${label}${n === 1 ? '' : 's'}` : null;
  };
  const parts = [count('skill', 'skill'), count('agent', 'agent'), count('rule', 'rule'), count('command', 'command')].filter(Boolean);
  const upstream = [...new Set(sources.filter((s) => !s.original).map((s) => s.derivedFrom || s.name))].join(', ');
  const ownWork = sources.some((s) => s.original);
  let origin = 'Written for legacies';
  if (upstream) origin = ownWork ? `Adapted from ${upstream}, with content written for legacies` : `Adapted from ${upstream}`;
  return `legacies ${packId} pack: ${parts.join(', ')}. ${origin}; not yet evaluated.`;
}

function writeApacheFiles(packDir, written, source, apacheLicenseFile) {
  const apache = written.filter((w) => w.license === APACHE);
  if (!apache.length) return;
  if (!apacheLicenseFile) throw new Error(`Pack ${path.basename(packDir)} has Apache-2.0 content but no license text was given`);
  writeFile(path.join(packDir, `LICENSE-${APACHE}.txt`), fs.readFileSync(apacheLicenseFile));
  writeFile(path.join(packDir, 'NOTICE'), [
    `This pack contains files adapted from ${source.name}${source.url ? ` (${source.url})` : ''} that are licensed under the`,
    `Apache License, Version 2.0; see LICENSE-${APACHE}.txt. legacies modified them (frontmatter trimmed, argument tokens escaped).`,
    '',
    ...apache.map((w) => `- ${w.from.replace(/^[^/]+\//, '')}`),
    '',
  ].join('\n'));
}

// A pack's eval suite travels with it, so `claude plugin eval packs/<pack>` runs it. The folder is not
// called evals/: an eval run from the repository root picks up every evals/ folder below it.
export const PACK_EVALS_DIR = 'pack-evals';

function copyEvals(evalsRoot, packId, packDir) {
  const src = evalsRoot ? path.join(evalsRoot, packId) : null;
  if (!src || !fs.existsSync(src)) return false;
  fs.cpSync(src, path.join(packDir, PACK_EVALS_DIR), { recursive: true, filter: (file) => path.basename(file) !== 'results' });
  return true;
}

// Rebuilds packs/ from the registry: one Claude Code plugin per pack, each depending on the core.
// `coreRoot` is the core plugin's folder; its components, and the Claude Code built-ins the registry
// lists (such as /code-review), count as shipped wherever a pack names them.
export function buildPacks({ registry, sourceRoots, coreRoot = null, evalsRoot = null, overridesRoot, outDir, version, author, apacheLicenseFile = null, patches = {} }) {
  const report = {
    built: [], inCore: [], plugins: [], overridden: [], patched: [], patchFailures: [], unusedPatches: [],
    scripts: [], commandTokens: [], mentions: [], danglingReferences: [], missing: [],
  };
  const pluginOf = new Map();
  for (const pack of registry.packs) for (const m of pack.members) if (m.kind !== 'rule') pluginOf.set(memberName(m), `${CORE_PLUGIN}-${pack.id}`);
  const coreNames = componentNames(coreRoot);
  const names = {
    vocabulary: new Set([...Object.values(sourceRoots).flatMap(componentNames), ...coreNames]),
    shipped: new Set([...pluginOf.keys(), ...coreNames, ...(registry.builtIns || [])]),
  };
  const ctx = { report, patches, pluginOf, names, rel: (file) => toPosix(path.relative(outDir, file)) };
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const pack of registry.packs) {
    if (!pack.members.length) {
      if (pack.inCore?.length) report.inCore.push(pack.id);
      continue;
    }
    const packDir = path.join(outDir, pack.id);
    const written = [];
    for (const member of pack.members) {
      const resolved = resolveMember(member, sourceRoots, overridesRoot);
      if (!fs.existsSync(resolved.mainFile)) {
        report.missing.push(`${member.source}/${member.path}`);
        continue;
      }
      if (resolved.overridden) report.overridden.push(`${member.source}/${member.path}`);
      written.push(writeMember(member, resolved, packDir, registry.sources[member.source], ctx));
    }
    if (!written.length) continue;
    const source = registry.sources[pack.members[0].source];
    const description = packDescription(pack.id, written, pack.members.map((m) => registry.sources[m.source]));
    writeApacheFiles(packDir, written, source, apacheLicenseFile);
    const hasEvals = copyEvals(evalsRoot, pack.id, packDir);
    writeFile(path.join(packDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({
      name: `${CORE_PLUGIN}-${pack.id}`,
      version,
      description,
      author: { name: author },
      license: pack.license,
      keywords: pack.topics.slice(0, 8),
      dependencies: [CORE_PLUGIN],
      ...(hasEvals ? { experimental: { evals: PACK_EVALS_DIR } } : {}),
    }, null, 2)}\n`);
    writeFile(path.join(packDir, 'pack.json'), `${JSON.stringify({
      id: pack.id, layer: pack.layer, status: pack.status, license: pack.license, topics: pack.topics, detect: pack.detect,
      members: written, merged: pack.merged,
    }, null, 2)}\n`);
    report.built.push(pack.id);
    report.plugins.push({ name: `${CORE_PLUGIN}-${pack.id}`, source: `./${PACKS_DIR}/${pack.id}`, description, version });
  }
  const used = new Set(report.patched);
  report.unusedPatches = Object.keys(patches).filter((key) => !used.has(key));
  return report;
}
