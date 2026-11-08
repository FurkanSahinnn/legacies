#!/usr/bin/env node
// Maintainer tool: generate Codex compatibility manifests from the canonical Claude
// plugin metadata. Skill content stays in one place; only the host-specific overlay
// and marketplace catalog are generated here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');
const CODEX_MARKETPLACE = path.join(ROOT, '.agents', 'plugins', 'marketplace.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return true;
}

function countSkills(pluginRoot) {
  const skills = path.join(pluginRoot, 'skills');
  if (!fs.existsSync(skills)) return 0;
  return fs.readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skills, entry.name, 'SKILL.md')))
    .length;
}

function relativeSource(pluginRoot) {
  const relative = path.relative(ROOT, pluginRoot).replaceAll(path.sep, '/');
  return relative ? `./${relative}` : './';
}

const packRoots = fs.readdirSync(PACKS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(PACKS, entry.name));

const plugins = [];
let skillCount = 0;
let changed = 0;

for (const pluginRoot of [ROOT, ...packRoots]) {
  const count = countSkills(pluginRoot);
  if (!count) continue;

  const claudeManifest = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
  const codexManifest = {
    name: claudeManifest.name,
    version: claudeManifest.version,
    description: claudeManifest.description,
    author: claudeManifest.author,
    license: claudeManifest.license,
    keywords: claudeManifest.keywords,
    skills: './skills/',
  };

  // The root contains Claude-specific hooks/hooks.json. Legacies installs its
  // Codex hooks per project with `legacies codex install`; an explicit empty
  // value prevents Codex plugin auto-discovery from running the Claude hooks too.
  if (pluginRoot === ROOT) codexManifest.hooks = {};

  if (writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), codexManifest)) changed += 1;

  const packName = claudeManifest.name.replace(/^legacies-/, '');
  plugins.push({
    name: claudeManifest.name,
    source: {
      source: 'local',
      path: relativeSource(pluginRoot),
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Productivity',
    interface: {
      displayName: pluginRoot === ROOT ? 'Legacies' : `Legacies: ${packName}`,
    },
  });
  skillCount += count;
}

const marketplace = {
  name: 'legacies',
  interface: {
    displayName: 'Legacies',
  },
  plugins,
};
if (writeJson(CODEX_MARKETPLACE, marketplace)) changed += 1;

process.stdout.write(`generated ${plugins.length} Codex plugins covering ${skillCount} skills (${changed} files changed)\n`);
