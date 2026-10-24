import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planCodexHooks, removeAgentsBlock, removeCodexHooks } from '../scripts/lib/codex.mjs';
import { cli, commit, gitRepo, hook, initMemory, run, tempDir, write } from './helpers.mjs';

const ECC_HOOKS = {
  hooks: {
    PreToolUse: [{ matcher: 'apply_patch|Edit|Write', hooks: [{ type: 'command', command: 'node "C:/Users/x/.codex/gateguard-codex.mjs"' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'other-tool stop' }] }],
  },
};

test('planCodexHooks keeps other hooks and is idempotent', () => {
  const once = planCodexHooks(ECC_HOOKS, 'D:\\Plugins\\legacies\\scripts\\legacies.mjs');
  const twice = planCodexHooks(once, 'D:\\Plugins\\legacies\\scripts\\legacies.mjs');
  assert.deepEqual(twice, once, 'second install changes nothing');
  assert.equal(once.hooks.Stop.length, 2, 'the other tool keeps its Stop hook');
  assert.ok(once.hooks.PreToolUse, "another tool's PreToolUse hook stays");
  assert.match(once.hooks.SessionStart[0].hooks[0].command, /node "D:\/Plugins\/legacies\/scripts\/legacies\.mjs" hook session-start --harness codex/);
  assert.equal(once.hooks.SessionStart[0].hooks[0].commandWindows, once.hooks.SessionStart[0].hooks[0].command);
  assert.equal(once.hooks.PostToolUse[0].matcher, 'apply_patch|Edit|Write|MultiEdit|NotebookEdit');

  const removed = removeCodexHooks(once);
  assert.deepEqual(Object.keys(removed.hooks), ['PreToolUse', 'Stop']);
});

test('removeAgentsBlock drops the block an earlier version wrote and keeps the rest', () => {
  const user = '# My rules\n\nBe concise.\n';
  const withBlock = `${user}\n<!-- legacies:start -->\n## legacies: project memory\n\n- Run legacies search first.\n<!-- legacies:end -->\n`;
  assert.equal(removeAgentsBlock(withBlock).trim(), user.trim());
});

// A Codex home with hooks turned on, plus a launcher folder, both thrown away after the test.
function codexEnv() {
  const home = tempDir('codex-home-');
  write(home, 'config.toml', '[features]\nhooks = true\n');
  return { CODEX_HOME: home, LEGACIES_BIN_DIR: tempDir('legacies-bin-') };
}

const OTHER_TOOL = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool stop' }] }] } };

test('codex install writes the hooks into the project and keeps git status clean', () => {
  const root = gitRepo();
  const install = cli(root, ['codex', 'install'], { env: codexEnv() });
  assert.equal(install.status, 0, install.stderr);
  const hooks = JSON.parse(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.SessionStart && hooks.hooks.UserPromptSubmit);
  assert.equal(run(root, 'git', ['status', '--porcelain']), '');
});

test("codex install leaves Codex's user folder untouched", () => {
  const env = codexEnv();
  cli(gitRepo(), ['codex', 'install'], { env });
  assert.deepEqual(fs.readdirSync(env.CODEX_HOME), ['config.toml']);
});

test('codex status reports the project hooks', () => {
  const env = codexEnv();
  const root = gitRepo();
  cli(root, ['codex', 'install'], { env });
  const status = cli(root, ['codex', 'status'], { env });
  assert.match(status.stdout, /legacies hook'ları \(\.codex\/hooks\.json\): var/);
  assert.match(status.stdout, /hooks = true: evet/);
});

test("codex uninstall removes legacies' hooks and keeps another tool's", () => {
  const env = codexEnv();
  const root = gitRepo();
  write(root, '.codex/hooks.json', JSON.stringify(OTHER_TOOL));
  cli(root, ['codex', 'install'], { env });
  const uninstall = cli(root, ['codex', 'uninstall'], { env });
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8')), OTHER_TOOL);
});

test('codex uninstall deletes the hooks file and folder it created', () => {
  const env = codexEnv();
  const root = gitRepo();
  cli(root, ['codex', 'install'], { env });
  cli(root, ['codex', 'uninstall'], { env });
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
});

test('codex install refuses a hooks.json the repository tracks', () => {
  const root = gitRepo();
  write(root, '.codex/hooks.json', JSON.stringify(OTHER_TOOL));
  commit(root, 'team codex hooks');
  const res = cli(root, ['codex', 'install'], { env: codexEnv() });
  assert.equal(res.status, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8')), OTHER_TOOL);
});

test('codex install refuses to overwrite a broken hooks.json', () => {
  const root = gitRepo();
  write(root, '.codex/hooks.json', '{ broken');
  const res = cli(root, ['codex', 'install'], { env: codexEnv() });
  assert.equal(res.status, 1);
  assert.equal(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'), '{ broken');
});

test('codex install needs a project folder', () => {
  const res = cli(tempDir(), ['codex', 'install'], { env: codexEnv() });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /proje başına/);
});

test('codex harness: apply_patch edits are recorded and the context names CLI commands', () => {
  const root = gitRepo();
  initMemory(root);
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** End Patch';
  for (let i = 0; i < 2; i += 1) {
    const res = cli(root, ['hook', 'post-tool-use', '--harness', 'codex'], {
      input: JSON.stringify({ cwd: root, session_id: 'codex-1', tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patch] } }),
    });
    assert.equal(res.status, 0);
  }
  const ledger = fs.readFileSync(path.join(root, '.legacies', 'state', 'sessions', 'codex-1.jsonl'), 'utf8');
  assert.match(ledger, /src\/a\.ts/);
  assert.match(ledger, /src\/b\.ts/);

  const start = cli(root, ['hook', 'session-start', '--harness', 'codex'], { input: JSON.stringify({ cwd: root, session_id: 'codex-1', source: 'startup' }) });
  const text = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, /legacies handoff --text/);
  assert.doesNotMatch(text, /\/legacies:remember/);
});

test('rules install writes into the project but keeps git status clean', () => {
  const root = gitRepo();
  const install = cli(root, ['rules', 'install']);
  assert.equal(install.status, 0, install.stderr);
  const dir = path.join(root, '.claude', 'rules');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('legacies-'));
  assert.ok(files.length > 0, 'bundled rules copied');
  assert.equal(run(root, 'git', ['status', '--porcelain']), '', 'rules and manifest are hidden from git');
  const again = cli(root, ['rules', 'install']);
  assert.match(again.stdout, /zaten/);
  assert.equal(cli(root, ['rules', 'uninstall']).status, 0);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('legacies-')).length, 0);
  assert.equal(cli(tempDir(), ['rules', 'install']).status, 2, 'needs a project folder');
});

test('legacies context outside Claude Code names CLI commands instead of plugin skills', () => {
  const root = gitRepo();
  initMemory(root);
  const outside = cli(root, ['context'], { env: { CLAUDECODE: '' } });
  assert.match(outside.stdout, /legacies handoff --text/);
  assert.doesNotMatch(outside.stdout, /\/legacies:/);
  const inside = cli(root, ['context'], { env: { CLAUDECODE: '1' } });
  assert.match(inside.stdout, /\/legacies:handoff/);
});

test('rules uninstall removes only the files legacies installed', () => {
  const root = gitRepo();
  write(root, '.claude/rules/mine.md', 'user rule');
  cli(root, ['rules', 'install']);
  const uninstall = cli(root, ['rules', 'uninstall']);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.deepEqual(fs.readdirSync(path.join(root, '.claude', 'rules')), ['mine.md']);
});

test('rules install writes nothing into the Claude config folder', () => {
  const config = tempDir('claude-config-');
  const install = cli(gitRepo(), ['rules', 'install'], { env: { CLAUDE_CONFIG_DIR: config } });
  assert.equal(install.status, 0, install.stderr);
  assert.deepEqual(fs.readdirSync(config), []);
});
