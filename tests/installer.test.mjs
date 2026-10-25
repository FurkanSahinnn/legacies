import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GRAPHIFY_SPEC, GRAPHIFY_VERSION } from '../scripts/lib/graphify.mjs';
import { commit, gitRepo, run, tempDir, write } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP = path.join(ROOT, 'scripts', 'setup.mjs');
const CLI = path.join(ROOT, 'scripts', 'legacies.mjs');
const FAKE = path.join(ROOT, 'tests', 'fixtures', 'fake-claude.mjs');
const FAKE_CODEX = path.join(ROOT, 'tests', 'fixtures', 'fake-codex.mjs');
const FAKE_UV = path.join(ROOT, 'tests', 'fixtures', 'fake-uv.mjs');
const FAKE_GRAPHIFY = path.join(ROOT, 'tests', 'fixtures', 'fake-graphify.mjs');

// A throwaway home: Claude config, Codex home, launcher folder and a fake `claude` that records every call.
function sandbox(initial = {}) {
  const home = tempDir('legacies-home-');
  const config = path.join(home, '.claude');
  fs.mkdirSync(config, { recursive: true });
  const stateFile = path.join(home, 'fake-claude.json');
  fs.writeFileSync(stateFile, JSON.stringify({ plugins: [], marketplaces: [], calls: [], ...initial }));
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_PLUGIN_DATA: path.join(config, 'plugins', 'data', 'legacies-legacies'),
    CODEX_HOME: path.join(home, '.codex'),
    LEGACIES_BIN_DIR: path.join(home, 'bin'),
    LEGACIES_CLAUDE_BIN: FAKE,
    LEGACIES_CODEX_BIN: '__none__',
    LEGACIES_UV_BIN: FAKE_UV,
    LEGACIES_GRAPHIFY_BIN: '__none__',
    FAKE_UV_LOG: path.join(home, 'uv-calls.jsonl'),
    FAKE_CLAUDE_STATE: stateFile,
    NO_COLOR: '1',
  };
  return {
    home,
    config,
    env,
    setup: (args, cwd = home) => spawnSync(process.execPath, [SETUP, ...args, '--no-anim'], { cwd, env, encoding: 'utf8' }),
    cli: (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' }),
    state: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    uvCalls: () => (fs.existsSync(env.FAKE_UV_LOG) ? fs.readFileSync(env.FAKE_UV_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
  };
}

const installLocal = (s, project, extra = []) => s.setup(['install', '--yes', '--scope', 'local', '--no-codex', '--no-graphify', ...extra], project);

test('install registers the marketplace, writes the launcher and records the project in a manifest', () => {
  const s = sandbox();
  const project = gitRepo();
  const r = installLocal(s, project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /kuruldu/);
  assert.ok(s.state().marketplaces.some((m) => m.name === 'legacies' && path.resolve(m.path) === ROOT));
  assert.ok(fs.existsSync(path.join(s.home, 'bin', 'legacies')));
  const manifest = JSON.parse(fs.readFileSync(path.join(s.config, 'legacies-install.json'), 'utf8'));
  assert.deepEqual(manifest.scopes.map((x) => [x.scope, path.resolve(x.projectRoot)]), [['local', path.resolve(project)]]);
});

test('install ends by pointing to the usage guide', () => {
  const s = sandbox();
  const r = installLocal(s, gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Kullanım rehberi:[\s\S]*docs[\\/]KULLANIM\.md/);
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'KULLANIM.md')));
});

test('install refuses the global scope and changes nothing', () => {
  const s = sandbox();
  const r = s.setup(['install', '--yes', '--scope', 'user'], gitRepo());
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /proje başına kurulur/);
  assert.deepEqual(s.state().calls, []);
});

test("a project install puts the Codex hooks into the project and leaves Codex's user folder alone", () => {
  const s = sandbox();
  fs.mkdirSync(s.env.CODEX_HOME, { recursive: true });
  s.env.LEGACIES_CODEX_BIN = FAKE_CODEX;
  const project = gitRepo();
  const r = s.setup(['install', '--yes', '--scope', 'local', '--codex', '--no-graphify'], project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(project, '.codex', 'hooks.json'), 'utf8'), /hook session-start --harness codex/);
  assert.deepEqual(fs.readdirSync(s.env.CODEX_HOME), []);
});

const earlierGlobalInstall = () => sandbox({ plugins: [{ id: 'legacies@legacies', scope: 'user', enabled: true, installPath: 'cache' }] });

test('a project install uninstalls the global plugin of an earlier version and keeps the shared plugin data', () => {
  const s = earlierGlobalInstall();
  const r = installLocal(s, gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const state = s.state();
  assert.deepEqual(state.plugins.map((p) => p.scope), ['local']);
  assert.ok(state.calls.includes('plugin uninstall legacies@legacies --scope user --keep-data -y'), state.calls.join('\n'));
});

test("a project install removes the global rules of an earlier version but not the user's own", () => {
  const s = sandbox();
  const rules = path.join(s.config, 'rules');
  write(rules, 'legacies-common-core.md', 'old core rule');
  write(rules, '.legacies-rules.json', JSON.stringify({ files: ['legacies-common-core.md'] }));
  write(rules, 'mine.md', 'my own rule');
  const r = installLocal(s, gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fs.readdirSync(rules), ['mine.md']);
});

test("a project install removes the global Codex adapter of an earlier version and keeps other tools' hooks", () => {
  const s = sandbox();
  const codex = s.env.CODEX_HOME;
  const other = { type: 'command', command: 'other-tool stop' };
  const ours = { type: 'command', command: 'node "D:/old/legacies/scripts/legacies.mjs" hook stop --harness codex' };
  write(codex, 'hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [ours] }, { hooks: [other] }] } }));
  write(codex, 'AGENTS.md', '<!-- legacies:start -->\n## legacies: project memory\n<!-- legacies:end -->\n');
  const r = installLocal(s, gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codex, 'hooks.json'), 'utf8')).hooks.Stop, [{ hooks: [other] }]);
  assert.equal(fs.existsSync(path.join(codex, 'AGENTS.md')), false, 'an AGENTS.md holding only the legacies block goes');
});

test('--keep-global leaves the global install of an earlier version in place', () => {
  const s = earlierGlobalInstall();
  const r = installLocal(s, gitRepo(), ['--keep-global']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(s.state().plugins.some((p) => p.scope === 'user'));
});

test('a second install changes nothing that is already in place', () => {
  const s = sandbox();
  const project = gitRepo();
  installLocal(s, project);
  const again = installLocal(s, project);
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /zaten kayıtlı/);
  assert.match(again.stdout, /zaten kurulu/);
  assert.equal(s.state().calls.filter((c) => c.startsWith('plugin install')).length, 1);
});

test('--dry-run only reads: no claude command that changes state, no files', () => {
  const s = sandbox();
  const r = s.setup(['install', '--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Dokunulmayacaklar/);
  assert.ok(s.state().calls.every((c) => /--version|list/.test(c)), s.state().calls.join('\n'));
  assert.ok(!fs.existsSync(path.join(s.config, 'rules')));
  assert.ok(!fs.existsSync(path.join(s.config, 'legacies-install.json')));
});

test('the analysis flags ECC and same-named skills before anything is installed', () => {
  const ecc = tempDir('fake-ecc-');
  write(ecc, 'hooks/hooks.json', JSON.stringify({ hooks: { SessionStart: [], PreToolUse: [], Stop: [] } }));
  write(ecc, 'skills/tdd-workflow/SKILL.md', '---\nname: tdd-workflow\n---\n');
  const s = sandbox({ plugins: [{ id: 'ecc@ecc', scope: 'user', enabled: true, installPath: ecc }] });
  const r = s.setup(['install', '--dry-run']);
  assert.match(r.stdout, /ecc@ecc etkin/);
  assert.match(r.stdout, /öneri: claude plugin disable ecc@ecc/);
  assert.match(r.stdout, /tdd-workflow/);
  assert.match(r.stdout, /araç çağrılarını denetliyor/);
});

test('--disable-ecc turns ECC off and uninstall turns it back on', () => {
  const ecc = tempDir('fake-ecc-');
  write(ecc, 'hooks/hooks.json', JSON.stringify({ hooks: { SessionStart: [] } }));
  const s = sandbox({ plugins: [{ id: 'ecc@ecc', scope: 'user', enabled: true, installPath: ecc }] });
  const r = installLocal(s, gitRepo(), ['--disable-ecc']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Diğer plugin'ler ve ayarları \(ecc@ecc yalnız kapatılır, silinmez\)/);
  assert.equal(s.state().plugins.find((p) => p.id === 'ecc@ecc').enabled, false);
  const u = s.setup(['uninstall', '--yes']);
  assert.equal(u.status, 0, u.stdout);
  assert.equal(s.state().plugins.find((p) => p.id === 'ecc@ecc').enabled, true);
});

test('uninstall removes every installed part but keeps project memories by default', () => {
  const s = sandbox();
  const project = gitRepo();
  installLocal(s, project);
  assert.equal(s.cli(['init'], project).status, 0);
  const u = s.setup(['uninstall', '--yes']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  const state = s.state();
  assert.equal(state.plugins.length, 0);
  assert.equal(state.marketplaces.length, 0);
  assert.ok(!fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-common-core.md')));
  assert.ok(!fs.existsSync(path.join(s.home, 'bin', 'legacies')));
  assert.ok(!fs.existsSync(path.join(s.config, 'legacies-install.json')));
  assert.ok(!fs.existsSync(s.env.CLAUDE_PLUGIN_DATA));
  assert.ok(fs.existsSync(path.join(project, '.legacies')), 'project memory stays');
  assert.ok(fs.existsSync(ROOT), 'the source folder is never touched');
  assert.match(u.stdout, /Proje hafızaları korundu/);
});

test("install puts the pinned graphify in legacies' own uv tool folder, without asking", () => {
  const s = sandbox();
  const r = s.setup(['install', '--yes', '--scope', 'local', '--no-codex'], gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [call] = s.uvCalls();
  assert.deepEqual(call.args, ['tool', 'install', '--force', GRAPHIFY_SPEC]);
  // A graphify the user installed with uv lives in uv's default folders, so it is never replaced.
  assert.equal(path.resolve(call.toolDir), path.join(s.env.CLAUDE_PLUGIN_DATA, 'graphify', 'tools'));
  assert.equal(path.resolve(call.binDir), path.join(s.env.CLAUDE_PLUGIN_DATA, 'graphify', 'bin'));
});

test('install leaves graphify alone when the pinned version is already there', () => {
  const s = sandbox();
  Object.assign(s.env, { LEGACIES_GRAPHIFY_BIN: FAKE_GRAPHIFY, FAKE_GRAPHIFY_VERSION: GRAPHIFY_VERSION });
  const r = s.setup(['install', '--yes', '--scope', 'local', '--no-codex'], gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(s.uvCalls(), []);
});

test('install replaces a graphify of another version with the pinned one', () => {
  const s = sandbox();
  Object.assign(s.env, { LEGACIES_GRAPHIFY_BIN: FAKE_GRAPHIFY, FAKE_GRAPHIFY_VERSION: '0.9.80' });
  const r = s.setup(['install', '--yes', '--scope', 'local', '--no-codex'], gitRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(s.uvCalls().map((c) => c.args), [['tool', 'install', '--force', GRAPHIFY_SPEC]]);
});

test('install plans uv before graphify when uv is missing, and --no-graphify plans neither', () => {
  const s = sandbox();
  s.env.LEGACIES_UV_BIN = '__none__';
  const project = gitRepo();
  const plan = s.setup(['install', '--yes', '--scope', 'local', '--no-codex', '--dry-run'], project).stdout;
  assert.ok(plan.indexOf('uv (') !== -1 && plan.indexOf('uv (') < plan.indexOf('graphify (kod haritası'), plan);
  const skipped = s.setup(['install', '--yes', '--scope', 'local', '--no-codex', '--no-graphify', '--dry-run'], project).stdout;
  assert.doesNotMatch(skipped, /graphify \(kod haritası|uv \(/);
});

test("uninstall removes legacies' own graphify with the plugin data and never runs uv tool uninstall", () => {
  const s = sandbox();
  const project = gitRepo();
  s.setup(['install', '--yes', '--scope', 'local', '--no-codex'], project);
  const own = path.join(s.env.CLAUDE_PLUGIN_DATA, 'graphify', 'bin');
  fs.mkdirSync(own, { recursive: true });
  const u = s.setup(['uninstall', '--yes']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.ok(!fs.existsSync(own));
  assert.equal(s.uvCalls().some((c) => c.args[1] === 'uninstall'), false, JSON.stringify(s.uvCalls()));
});

test('uninstall --delete-memories removes .legacies and the exclude line it added', () => {
  const s = sandbox();
  const project = gitRepo();
  installLocal(s, project);
  s.cli(['init'], project);
  const u = s.setup(['uninstall', '--yes', '--delete-memories']);
  assert.equal(u.status, 0, u.stdout);
  assert.ok(!fs.existsSync(path.join(project, '.legacies')));
  assert.doesNotMatch(fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8'), /\.legacies/);
  assert.equal(run(project, 'git', ['status', '--porcelain']), '');
});

test('local scope installs into the current project, keeps git clean, and needs a project folder', () => {
  const s = sandbox();
  const project = gitRepo();
  const r = s.setup(['install', '--yes', '--scope', 'local', '--no-codex', '--no-graphify', '--no-launcher'], project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const entry = s.state().plugins.find((p) => p.id === 'legacies@legacies');
  assert.equal(entry.scope, 'local');
  assert.equal(path.resolve(entry.projectPath), path.resolve(project));
  assert.ok(fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-common-core.md')));
  assert.equal(run(project, 'git', ['status', '--porcelain']), '');
  const outside = s.setup(['install', '--yes', '--scope', 'local'], tempDir());
  assert.equal(outside.status, 2);
});

test('the summary box wraps a line wider than the terminal so its right border stays aligned', () => {
  const tui = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'tui.mjs')).href;
  const long = "1. Claude Code'u yeniden başlat ya da açık oturumda /reload-plugins çalıştır, sonra bir projede /legacies:onboard komutunu çalıştır.";
  const script = `import { box } from ${JSON.stringify(tui)}; box('legacies kuruldu', [${JSON.stringify(long)}, '', 'kısa satır']);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.split('\n').filter(Boolean);
  assert.equal(new Set(rows.map((row) => [...row].length)).size, 1, r.stdout);
  assert.ok(rows.length >= 6, `the long line wraps onto several rows:\n${r.stdout}`);
  assert.match(r.stdout, /^ {2}[│|] {4}\S/m, 'continuation rows hang under the text after "1. "');
  assert.match(r.stdout, /legacies:onboard/);
});

test('install prints the PATH command as one copyable row below the summary box', () => {
  const s = sandbox();
  const lines = installLocal(s, gitRepo()).stdout.split('\n');
  const boxEnd = lines.findIndex((l) => /^ {2}[╰+][─-]+[╯+]$/.test(l));
  const hint = lines.findIndex((l) => l.includes('eklemek için çalıştır'));
  assert.ok(boxEnd > 0 && hint > boxEnd, lines.join('\n'));
  const command = lines[hint + 1].trim();
  assert.ok(command.includes(path.join(s.home, 'bin')), command);
  assert.doesNotMatch(command, /│|^\||\|$/);
  if (process.platform === 'win32') assert.doesNotMatch(command, /\$env:Path/, 'the machine Path is not copied into the user Path');
  else assert.match(command, /^(echo 'export PATH=|fish_add_path )/);
});

test('a missing Claude Code CLI stops the install before anything changes', () => {
  const s = sandbox();
  const r = spawnSync(process.execPath, [SETUP, 'install', '--yes', '--no-anim'], { cwd: s.home, env: { ...s.env, LEGACIES_CLAUDE_BIN: '__none__' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Claude Code CLI/);
  assert.match(r.stdout, /claude\.ai\/install/);
  assert.deepEqual(fs.readdirSync(s.config), []);
});

const reactProject = () => {
  const project = gitRepo();
  write(project, 'package.json', JSON.stringify({ dependencies: { react: '19.0.0', next: '15.0.0' } }));
  commit(project, 'add package.json');
  return project;
};

test('packs suggest reports the packs a project\'s dependencies point to', () => {
  const s = sandbox();
  const r = s.cli(['packs', 'suggest', '--json'], reactProject());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const react = JSON.parse(r.stdout).packs.find((p) => p.id === 'react');
  assert.ok(react.reasons.includes('package.json: react'), r.stdout);
  assert.equal(react.enabled, false);
});

test('packs add installs a pack at local scope and copies its rules without touching git', () => {
  const s = sandbox({ marketplaces: [{ name: 'legacies', source: 'directory', path: ROOT }] });
  const project = reactProject();
  const r = s.cli(['packs', 'add', 'react', '--no-anim'], project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const entry = s.state().plugins.find((p) => p.id === 'legacies-react@legacies');
  assert.equal(entry.scope, 'local');
  assert.equal(path.resolve(entry.projectPath), path.resolve(project));
  assert.ok(fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-react-react.md')));
  assert.equal(run(project, 'git', ['status', '--porcelain']), '');
});

test('packs off turns a pack off without uninstalling it and takes its rules away', () => {
  const s = sandbox({ marketplaces: [{ name: 'legacies', source: 'directory', path: ROOT }] });
  const project = reactProject();
  s.cli(['packs', 'on', 'react', '--no-anim'], project);
  const r = s.cli(['packs', 'off', 'react', '--no-anim'], project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const entry = s.state().plugins.find((p) => p.id === 'legacies-react@legacies');
  assert.ok(entry, 'the pack stays installed');
  assert.equal(entry.projectEnabled, false);
  assert.equal(fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-react-react.md')), false);
});

test('packs on turns a pack that was off back on without installing it again', () => {
  const s = sandbox({ marketplaces: [{ name: 'legacies', source: 'directory', path: ROOT }] });
  const project = reactProject();
  s.cli(['packs', 'on', 'react', '--no-anim'], project);
  s.cli(['packs', 'off', 'react', '--no-anim'], project);
  const r = s.cli(['packs', 'on', 'react', '--no-anim'], project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(s.state().calls.filter((c) => c.startsWith('plugin install legacies-react')).length, 1);
  assert.equal(s.state().plugins.find((p) => p.id === 'legacies-react@legacies').projectEnabled, true);
  assert.ok(fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-react-react.md')));
});

test('packs remove deletes a pack after a yes and takes its rules away', () => {
  const s = sandbox({ marketplaces: [{ name: 'legacies', source: 'directory', path: ROOT }] });
  const project = reactProject();
  s.cli(['packs', 'on', 'react', '--no-anim'], project);
  const r = s.cli(['packs', 'remove', 'react', '--yes', '--no-anim'], project);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(s.state().plugins.some((p) => p.id === 'legacies-react@legacies'), false);
  assert.equal(fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-react-react.md')), false);
});

test('packs remove without an answer deletes nothing and says how to confirm', () => {
  const s = sandbox({ marketplaces: [{ name: 'legacies', source: 'directory', path: ROOT }] });
  const project = reactProject();
  s.cli(['packs', 'on', 'react', '--no-anim'], project);
  const r = s.cli(['packs', 'remove', 'react', '--no-anim'], project);
  assert.equal(r.status, 1);
  assert.ok(s.state().plugins.some((p) => p.id === 'legacies-react@legacies'), 'still installed');
  assert.match(r.stdout + r.stderr, /--yes/);
});

test('packs refuses user scope, because packs are per project', () => {
  const s = sandbox();
  const r = s.cli(['packs', 'add', 'react', '--scope', 'user'], reactProject());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /proje başına/);
  assert.equal(s.state().calls.some((c) => c.startsWith('plugin install')), false);
});

test('catalog add keeps a skill in the personal marketplace and registers it once', () => {
  const s = sandbox();
  const skill = path.join(tempDir(), 'deploy-checklist');
  write(skill, 'SKILL.md', '---\nname: deploy-checklist\ndescription: Our deploy steps.\n---\nSteps\n');
  const first = s.cli(['catalog', 'add', skill], s.home);
  const second = s.cli(['catalog', 'add', skill], s.home);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.ok(fs.existsSync(path.join(s.config, 'legacies-catalog', 'plugins', 'deploy-checklist', 'skills', 'deploy-checklist', 'SKILL.md')));
  assert.deepEqual(s.state().marketplaces.map((m) => m.name), ['legacies-personal']);
});

test('install run from the plugin folder only prepares the machine and installs into no project', () => {
  const s = sandbox();
  const r = s.setup(['install', '--yes', '--no-codex', '--no-graphify'], ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const state = s.state();
  assert.ok(state.marketplaces.some((m) => m.name === 'legacies'));
  assert.equal(state.calls.some((c) => c.startsWith('plugin install')), false);
  assert.ok(fs.existsSync(path.join(s.home, 'bin', 'legacies')));
  assert.match(r.stdout, /legacies setup/);
});

test('install with --multiagent turns the multi-agent setup on for this project', () => {
  const s = sandbox();
  const project = gitRepo();
  const r = installLocal(s, project, ['--multiagent']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(s.cli(['multiagent', 'status'], project).stdout, /: açık · Dengeli/);
});

test('install with --multiagent in the plugin folder turns it on as the default for every project', () => {
  const s = sandbox();
  const r = s.setup(['install', '--yes', '--no-codex', '--no-graphify', '--multiagent'], ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(s.cli(['multiagent', 'status'], gitRepo()).stdout, /: açık · Dengeli/);
});

test('uninstall removes the multi-agent settings', () => {
  const s = sandbox();
  installLocal(s, gitRepo(), ['--multiagent']);
  const u = s.setup(['uninstall', '--yes']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.equal(fs.existsSync(path.join(s.config, 'legacies-multiagent.json')), false);
});

test('packs add copies no rules for a pack whose install failed', () => {
  const s = sandbox({ marketplaces: [{ name: 'legacies', source: 'directory', path: ROOT }] });
  s.env.FAKE_CLAUDE_FAIL = 'plugin install legacies-react@legacies';
  const project = reactProject();
  const r = s.cli(['packs', 'add', 'react', '--no-anim'], project);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(project, '.claude', 'rules', 'legacies-react-react.md')), false);
});
