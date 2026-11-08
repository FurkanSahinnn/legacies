import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function skillCount(pluginRoot) {
  const dir = path.join(pluginRoot, 'skills');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .length;
}

function pluginRoots() {
  const packs = fs.readdirSync(PACKS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKS, entry.name));
  return [ROOT, ...packs].filter((pluginRoot) => skillCount(pluginRoot) > 0);
}

test('Codex manifests expose every core and pack skill without copying skill content', () => {
  const roots = pluginRoots();
  assert.equal(roots.length, 73, 'core plus 72 skill-bearing packs');
  assert.equal(roots.reduce((total, pluginRoot) => total + skillCount(pluginRoot), 0), 209);

  for (const pluginRoot of roots) {
    const claude = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
    const codex = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
    assert.equal(codex.name, claude.name);
    assert.equal(codex.version, claude.version);
    assert.equal(codex.description, claude.description);
    assert.deepEqual(codex.author, claude.author);
    assert.equal(codex.skills, './skills/');
  }

  assert.deepEqual(readJson(path.join(ROOT, '.codex-plugin', 'plugin.json')).hooks, {}, 'Claude hooks are not auto-loaded by Codex');
});

test('the Codex marketplace lists exactly the plugins that contain skills', () => {
  const marketplace = readJson(path.join(ROOT, '.agents', 'plugins', 'marketplace.json'));
  const roots = pluginRoots();
  assert.equal(marketplace.name, 'legacies');
  assert.equal(marketplace.plugins.length, roots.length);

  const listed = new Map(marketplace.plugins.map((plugin) => [plugin.name, plugin]));
  for (const pluginRoot of roots) {
    const manifest = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
    const entry = listed.get(manifest.name);
    assert.ok(entry, `${manifest.name} is missing from the Codex marketplace`);
    assert.equal(entry.source.source, 'local');
    assert.match(entry.source.path, /^\.\//);
    assert.equal(entry.policy.installation, 'AVAILABLE');
  }
});

test('explicit-only workflows stay explicit-only in Codex', () => {
  for (const name of ['spec', 'plan', 'review-pr']) {
    const config = fs.readFileSync(path.join(ROOT, 'skills', name, 'agents', 'openai.yaml'), 'utf8');
    assert.match(config, /allow_implicit_invocation:\s*false/);
  }
});

test('Codex generation is idempotent and does not rewrite Claude manifests', () => {
  const claudeFiles = [
    path.join(ROOT, '.claude-plugin', 'marketplace.json'),
    ...pluginRoots().map((pluginRoot) => path.join(pluginRoot, '.claude-plugin', 'plugin.json')),
  ];
  const before = new Map(claudeFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));
  const result = spawnSync(process.execPath, ['scripts/build-codex-plugins.mjs'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /73 Codex plugins covering 209 skills \(0 files changed\)/);
  for (const file of claudeFiles) assert.equal(fs.readFileSync(file, 'utf8'), before.get(file), file);
});
