import fs from 'node:fs';
import path from 'node:path';
import { listMarkdown } from './notes.mjs';
import { excludePattern, isGitRepo, removeExcludePattern } from './project.mjs';
import { claudeConfigDir, ensureDir, readJson, readText, toPosix, writeAtomic } from './util.mjs';

export const RULES_EXCLUDE = '/.claude/rules/*legacies*';
const MANIFEST = '.legacies-rules.json';
const PACK_RULES_MANIFEST = '.legacies-pack-rules.json';

// Every file is installed flat as legacies-<group>-<name>.md next to the project's own rules.
export const installedRuleName = (rel) => `legacies-${rel.replace(/\//g, '-')}`;

// Earlier versions also installed the rules here, for every project; setup now removes them.
export function userRulesDir() {
  return path.join(claudeConfigDir(), 'rules');
}

export function projectRulesDir(root) {
  return path.join(root, '.claude', 'rules');
}

export function bundledRules(pluginRoot) {
  const dir = path.join(pluginRoot, 'rules');
  return listMarkdown(dir).map((file) => {
    const text = readText(file, '');
    const scoped = /^---\n[\s\S]*?^paths:/m.test(text.replace(/\r\n/g, '\n'));
    return { file, rel: toPosix(path.relative(dir, file)), text, scoped, bytes: Buffer.byteLength(text) };
  });
}

// Bytes paid in every session: rules without a paths: scope.
export function unscopedBytes(rules) {
  return rules.filter((r) => !r.scoped).reduce((n, r) => n + r.bytes, 0);
}

export function installedRules(dir) {
  return (readJson(path.join(dir, MANIFEST), { files: [] }) || { files: [] }).files || [];
}

export function installRules(pluginRoot, dir, { projectRoot = null } = {}) {
  const rules = bundledRules(pluginRoot);
  const previous = installedRules(dir);
  const names = rules.map((r) => installedRuleName(r.rel));
  ensureDir(dir);
  rules.forEach((r, i) => writeAtomic(path.join(dir, names[i]), r.text));
  for (const name of previous) if (!names.includes(name)) fs.rmSync(path.join(dir, name), { force: true });
  // Not a .md file, so Claude Code never loads it as a rule.
  writeAtomic(path.join(dir, MANIFEST), JSON.stringify({ files: names, installedAt: new Date().toISOString() }, null, 2));
  const git = projectRoot && isGitRepo(projectRoot) ? excludePattern(projectRoot, RULES_EXCLUDE, '.claude/rules/legacies-common-core.md') : null;
  return { count: rules.length, unscoped: unscopedBytes(rules), git };
}

export function uninstallRules(dir, { projectRoot = null } = {}) {
  const names = installedRules(dir);
  for (const name of names) if (name.startsWith('legacies-')) fs.rmSync(path.join(dir, name), { force: true });
  fs.rmSync(path.join(dir, MANIFEST), { force: true });
  if (projectRoot && isGitRepo(projectRoot)) removeExcludePattern(projectRoot, RULES_EXCLUDE);
  return names.length;
}

// Plugins cannot carry rules, so each enabled pack's rules are copied into <project>/.claude/rules/
// and tracked in their own manifest; the core rules keep theirs.
export function syncPackRules(pluginRoot, root, packIds, { exclude = true } = {}) {
  const dir = projectRulesDir(root);
  const manifest = path.join(dir, PACK_RULES_MANIFEST);
  const previous = Object.values(readJson(manifest, { packs: {} })?.packs || {}).flat();
  const packs = {};
  for (const id of packIds) {
    const src = path.join(pluginRoot, 'packs', id, 'rules');
    const files = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => f.endsWith('.md')).sort() : [];
    if (!files.length) continue;
    packs[id] = files.map((file) => {
      writeAtomic(path.join(dir, `legacies-${file}`), fs.readFileSync(path.join(src, file), 'utf8'));
      return `legacies-${file}`;
    });
  }
  const kept = new Set(Object.values(packs).flat());
  const stale = previous.filter((name) => !kept.has(name));
  for (const name of stale) fs.rmSync(path.join(dir, name), { force: true });
  if (kept.size) writeAtomic(manifest, `${JSON.stringify({ packs, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  else fs.rmSync(manifest, { force: true });
  if (exclude && kept.size && isGitRepo(root)) excludePattern(root, RULES_EXCLUDE, `.claude/rules/${[...kept][0]}`);
  return { count: kept.size, removed: stale.length };
}

export function packRuleFiles(root) {
  return Object.values(readJson(path.join(projectRulesDir(root), PACK_RULES_MANIFEST), { packs: {} })?.packs || {}).flat();
}
