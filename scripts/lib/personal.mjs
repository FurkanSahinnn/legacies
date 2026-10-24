// The user's own skills, kept as a plugin marketplace on this machine so they can be turned on per
// project like packs. It lives outside the plugin data folder, so `legacies uninstall` keeps it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter } from './frontmatter.mjs';
import { claudeConfigDir, ensureDir, exists, readJson, readText, slugify, writeAtomic } from './util.mjs';

export const PERSONAL_MARKETPLACE = 'legacies-personal';
export const personalDir = () => path.join(claudeConfigDir(), 'legacies-catalog');
const GIT_SOURCE = /^(https?:\/\/|git@|ssh:\/\/)/;
const COMPONENT_DIRS = ['skills', 'agents', 'commands'];

const catalogFile = (dir) => path.join(dir, 'catalog.json');
const marketplaceFile = (dir) => path.join(dir, '.claude-plugin', 'marketplace.json');
const pluginsDir = (dir) => path.join(dir, 'plugins');
const hasSkill = (dir) => exists(path.join(dir, 'SKILL.md'));
const subdirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '.git').map((e) => e.name).sort();
const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (src) => path.basename(src) !== '.git' });

function skillDescription(skillDir) {
  return parseFrontmatter(readText(path.join(skillDir, 'SKILL.md'), '')).data.description || '';
}

// Writes plugins/<name> from whatever shape the source has: a plugin, a plugin-shaped folder without
// a manifest, one skill, or a folder of skills.
function writePlugin(src, target, name) {
  if (exists(path.join(src, '.claude-plugin', 'plugin.json'))) {
    copyTree(src, target);
    return fs.existsSync(path.join(target, 'skills')) ? subdirs(path.join(target, 'skills')) : [];
  }
  let skills;
  if (exists(path.join(src, 'skills'))) {
    for (const component of COMPONENT_DIRS.filter((d) => exists(path.join(src, d)))) copyTree(path.join(src, component), path.join(target, component));
    skills = subdirs(path.join(target, 'skills'));
  } else if (hasSkill(src)) {
    const skillName = slugify(parseFrontmatter(readText(path.join(src, 'SKILL.md'), '')).data.name || path.basename(src));
    copyTree(src, path.join(target, 'skills', skillName));
    skills = [skillName];
  } else {
    skills = subdirs(src).filter((d) => hasSkill(path.join(src, d)));
    for (const skill of skills) copyTree(path.join(src, skill), path.join(target, 'skills', skill));
  }
  const description = skills.length === 1 ? skillDescription(path.join(target, 'skills', skills[0])) : `${skills.length} skill: ${skills.join(', ')}`;
  writeAtomic(path.join(target, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name, version: '1.0.0', description: description || name }, null, 2)}\n`);
  return skills;
}

function sourceShape(src) {
  if (exists(path.join(src, '.claude-plugin', 'plugin.json')) || exists(path.join(src, 'skills')) || hasSkill(src)) return true;
  return subdirs(src).some((d) => hasSkill(path.join(src, d)));
}

function writeMarketplace(dir) {
  const catalog = readJson(catalogFile(dir), { plugins: {} }) || { plugins: {} };
  const plugins = Object.keys(catalog.plugins).sort().map((name) => {
    const manifest = readJson(path.join(pluginsDir(dir), name, '.claude-plugin', 'plugin.json'), {}) || {};
    return { name, source: `./plugins/${name}`, description: manifest.description || name };
  });
  writeAtomic(marketplaceFile(dir), `${JSON.stringify({
    name: PERSONAL_MARKETPLACE,
    owner: { name: 'legacies' },
    metadata: { description: 'Kendi eklediğin skill\'ler (legacies catalog add)' },
    plugins,
  }, null, 2)}\n`);
}

// A git source is cloned once at its current commit; the copy stays pinned until it is imported again.
function cloneSource(url) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacies-import-'));
  const clone = spawnSync('git', ['clone', '--depth', '1', '--quiet', url, tmp], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (clone.status !== 0) throw new Error(`git clone başarısız: ${(clone.stderr || '').trim().split('\n').pop()}`);
  const commit = spawnSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  return { tmp, commit };
}

export function importToPersonal(source, { dir = personalDir(), name = null } = {}) {
  const fromGit = GIT_SOURCE.test(source);
  const cloned = fromGit ? cloneSource(source) : null;
  try {
    let src = cloned ? cloned.tmp : path.resolve(source);
    if (!fromGit && fs.statSync(src).isFile()) src = path.dirname(src);
    if (!sourceShape(src)) throw new Error(`${source}: SKILL.md içeren bir skill klasörü, skill klasörleri ya da bir plugin bulunamadı`);
    const manifestName = readJson(path.join(src, '.claude-plugin', 'plugin.json'), {})?.name;
    const plugin = slugify(name || manifestName || path.basename(fromGit ? source.replace(/\.git$/, '') : src));
    const target = path.join(pluginsDir(dir), plugin);
    fs.rmSync(target, { recursive: true, force: true });
    const skills = writePlugin(src, target, plugin);
    const catalog = readJson(catalogFile(dir), { plugins: {} }) || { plugins: {} };
    catalog.plugins[plugin] = { source: fromGit ? source : src, ...(cloned ? { commit: cloned.commit } : {}), importedAt: new Date().toISOString() };
    ensureDir(dir);
    writeAtomic(catalogFile(dir), `${JSON.stringify(catalog, null, 2)}\n`);
    writeMarketplace(dir);
    return { name: plugin, skills };
  } finally {
    if (cloned) fs.rmSync(cloned.tmp, { recursive: true, force: true });
  }
}

export function listPersonal({ dir = personalDir() } = {}) {
  const catalog = readJson(catalogFile(dir), { plugins: {} }) || { plugins: {} };
  const listed = readJson(marketplaceFile(dir), { plugins: [] })?.plugins || [];
  return listed.map((p) => ({ name: p.name, description: p.description, ...catalog.plugins[p.name] }));
}

export function removePersonal(name, { dir = personalDir() } = {}) {
  const catalog = readJson(catalogFile(dir), { plugins: {} }) || { plugins: {} };
  if (!catalog.plugins[name]) throw new Error(`Kişisel katalogda "${name}" yok`);
  delete catalog.plugins[name];
  fs.rmSync(path.join(pluginsDir(dir), name), { recursive: true, force: true });
  writeAtomic(catalogFile(dir), `${JSON.stringify(catalog, null, 2)}\n`);
  writeMarketplace(dir);
}
