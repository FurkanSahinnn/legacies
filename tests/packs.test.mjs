import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildGroups, planPackChanges, projectPlugins, resolvePluginIds } from '../scripts/lib/packs.mjs';
import { syncPackRules } from '../scripts/lib/rules.mjs';
import { importToPersonal, listPersonal, removePersonal } from '../scripts/lib/personal.mjs';
import { tempDir, write } from './helpers.mjs';

const ROOT = tempDir('legacies-project-');
const pack = (id, extra = {}) => ({ id, layer: 'language', members: [{}], manifest: { members: [{ kind: 'skill' }, { kind: 'agent' }] }, ...extra });
const CATALOG = {
  packs: [pack('go'), pack('rust'), pack('react', { layer: 'frontend' })],
  official: [
    { name: 'gopls-lsp', brings: 'LSP (gopls; binary must be on PATH)' },
    { name: 'linear', brings: 'MCP (http, OAuth)' },
    { name: 'commit-commands', brings: '3 commands' },
  ],
};

const option = (groups, value) => groups.flatMap((g) => g.options).find((o) => o.value === value);

test('projectPlugins keeps this project\'s plugins and lets local scope win over project scope', () => {
  const listed = [
    { id: 'legacies-go@legacies', scope: 'project', projectPath: ROOT, projectEnabled: true },
    { id: 'legacies-go@legacies', scope: 'local', projectPath: ROOT, projectEnabled: false },
    { id: 'legacies-rust@legacies', scope: 'local', projectPath: path.join(ROOT, 'other'), projectEnabled: true },
    { id: 'legacies@legacies', scope: 'user', enabled: true },
  ];
  const plugins = projectPlugins(listed, ROOT);
  assert.deepEqual([...plugins.keys()], ['legacies-go@legacies']);
  assert.deepEqual(plugins.get('legacies-go@legacies'), { scope: 'local', on: false, scopes: ['project', 'local'] });
});

test('buildGroups pre-checks strong detections, offers weak ones unchecked and keeps enabled plugins checked', () => {
  const detection = { packs: [{ id: 'go', reasons: ['go.mod'], weak: false }, { id: 'rust', reasons: ['*.rs (2 dosya)'], weak: true }], official: [] };
  const plugins = new Map([['legacies-react@legacies', { scope: 'local', on: true, scopes: ['local'] }]]);
  const groups = buildGroups({ catalog: CATALOG, detection, plugins });
  assert.deepEqual(groups.map((g) => g.title), ['Bu projede tespit edilenler', 'Diğer legacies paketleri', "Diğer resmi plugin'ler"]);
  assert.equal(option(groups, 'legacies-go@legacies').checked, true);
  assert.equal(option(groups, 'legacies-rust@legacies').checked, false);
  assert.equal(option(groups, 'legacies-react@legacies').checked, true);
});

test('buildGroups pre-checks a detected official plugin only when it is safe to turn on', () => {
  const detection = {
    packs: [],
    official: ['gopls-lsp', 'linear', 'commit-commands'].map((name) => ({ name, reasons: ['go.mod'], weak: false })),
  };
  const withGopls = buildGroups({ catalog: CATALOG, detection, plugins: new Map(), hasBinary: (bin) => bin === 'gopls' });
  const withoutGopls = buildGroups({ catalog: CATALOG, detection, plugins: new Map(), hasBinary: () => false });
  assert.equal(option(withGopls, 'gopls-lsp@claude-plugins-official').checked, true);
  assert.equal(option(withoutGopls, 'gopls-lsp@claude-plugins-official').checked, false);
  assert.equal(option(withGopls, 'linear@claude-plugins-official').checked, false);
  assert.equal(option(withGopls, 'commit-commands@claude-plugins-official').checked, true);
});

test('planPackChanges installs new selections and turns deselected plugins off at their scope without uninstalling them', () => {
  const plugins = new Map([
    ['legacies-rust@legacies', { scope: 'local', on: true, scopes: ['local'] }],
    ['legacies-react@legacies', { scope: 'local', on: false, scopes: ['local'] }],
  ]);
  const options = ['legacies-go@legacies', 'legacies-rust@legacies', 'legacies-react@legacies'];
  const changes = planPackChanges({ selected: new Set(['legacies-go@legacies', 'legacies-react@legacies']), options, plugins, scope: 'local' });
  assert.deepEqual(changes.add, [{ id: 'legacies-go@legacies', action: 'install', scope: 'local' }, { id: 'legacies-react@legacies', action: 'enable', scope: 'local' }]);
  assert.deepEqual(changes.remove, [{ id: 'legacies-rust@legacies', action: 'disable', scope: 'local' }]);
});

test('planPackChanges turns a team-enabled plugin off only for this user', () => {
  const plugins = new Map([['legacies-go@legacies', { scope: 'project', on: true, scopes: ['project'] }]]);
  const changes = planPackChanges({ selected: new Set(), options: ['legacies-go@legacies'], plugins, scope: 'local' });
  assert.deepEqual(changes.remove, [{ id: 'legacies-go@legacies', action: 'disable', scope: 'local' }]);
});

test('resolvePluginIds maps pack ids, official names and full plugin ids', () => {
  const ids = resolvePluginIds(['go', 'commit-commands', 'linear@claude-plugins-official'], { catalog: CATALOG, personal: [] });
  assert.deepEqual(ids, { ids: ['legacies-go@legacies', 'commit-commands@claude-plugins-official', 'linear@claude-plugins-official'], unknown: [] });
  assert.deepEqual(resolvePluginIds(['cobol'], { catalog: CATALOG, personal: [] }).unknown, ['cobol']);
});

test('syncPackRules copies the rules of enabled packs and removes the rules of packs turned off', () => {
  const pluginRoot = tempDir();
  write(pluginRoot, 'packs/go/rules/golang-coding-style.md', '# Go style\n');
  write(pluginRoot, 'packs/rust/rules/rust-coding-style.md', '# Rust style\n');
  const project = tempDir();
  syncPackRules(pluginRoot, project, ['go', 'rust'], { exclude: false });
  const result = syncPackRules(pluginRoot, project, ['go'], { exclude: false });
  const rules = path.join(project, '.claude', 'rules');
  assert.equal(fs.readFileSync(path.join(rules, 'legacies-golang-coding-style.md'), 'utf8'), '# Go style\n');
  assert.equal(fs.existsSync(path.join(rules, 'legacies-rust-coding-style.md')), false);
  assert.deepEqual(result, { count: 1, removed: 1 });
});

test('importToPersonal wraps a single skill folder into a plugin of the personal marketplace', () => {
  const home = tempDir();
  const skill = path.join(tempDir(), 'deploy-checklist');
  write(skill, 'SKILL.md', '---\nname: deploy-checklist\ndescription: Our deploy steps.\n---\nSteps\n');
  write(skill, 'references/rollback.md', '# Rollback\n');
  const imported = importToPersonal(skill, { dir: home });
  assert.deepEqual(imported, { name: 'deploy-checklist', skills: ['deploy-checklist'] });
  assert.ok(fs.existsSync(path.join(home, 'plugins', 'deploy-checklist', 'skills', 'deploy-checklist', 'references', 'rollback.md')));
  const marketplace = JSON.parse(fs.readFileSync(path.join(home, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.deepEqual(marketplace.plugins.map((p) => [p.name, p.source]), [['deploy-checklist', './plugins/deploy-checklist']]);
});

test('importToPersonal turns a folder of skills into one plugin named after the folder', () => {
  const home = tempDir();
  const folder = path.join(tempDir(), 'Team Skills');
  write(folder, 'api-style/SKILL.md', '---\nname: api-style\ndescription: API rules.\n---\nx\n');
  write(folder, 'db-style/SKILL.md', '---\nname: db-style\ndescription: DB rules.\n---\nx\n');
  write(folder, 'notes.txt', 'not a skill\n');
  assert.deepEqual(importToPersonal(folder, { dir: home }), { name: 'team-skills', skills: ['api-style', 'db-style'] });
  assert.deepEqual(listPersonal({ dir: home }).map((p) => p.name), ['team-skills']);
});

test('importToPersonal refuses a folder that holds no skill', () => {
  const folder = tempDir();
  write(folder, 'README.md', '# nothing here\n');
  assert.throws(() => importToPersonal(folder, { dir: tempDir() }), /SKILL\.md/);
});

test('removePersonal deletes the plugin and its marketplace entry', () => {
  const home = tempDir();
  const skill = path.join(tempDir(), 'deploy-checklist');
  write(skill, 'SKILL.md', '---\nname: deploy-checklist\ndescription: Our deploy steps.\n---\nSteps\n');
  importToPersonal(skill, { dir: home });
  removePersonal('deploy-checklist', { dir: home });
  assert.equal(fs.existsSync(path.join(home, 'plugins', 'deploy-checklist')), false);
  assert.deepEqual(listPersonal({ dir: home }), []);
});
