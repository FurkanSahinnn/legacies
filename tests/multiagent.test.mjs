import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { roleOf } from '../scripts/lib/multiagent.mjs';
import { cli, gitRepo, hook, initMemory, tempDir } from './helpers.mjs';

const SETTINGS_DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'drive-settings.mjs');

const context = (res) => res.json && res.json.hookSpecificOutput && res.json.hookSpecificOutput.additionalContext;

// One computer: every call shares the Claude config folder, where the settings live.
function machine() {
  const env = { CLAUDE_CONFIG_DIR: tempDir('legacies-config-') };
  return {
    env,
    run(root, args) {
      const res = cli(root, ['multiagent', ...args], { env });
      assert.equal(res.status, 0, res.stderr);
      return res.stdout;
    },
    start: (root) => context(hook(root, 'session-start', { source: 'startup' }, { env })) || '',
  };
}

function project() {
  const root = gitRepo();
  initMemory(root);
  return root;
}

test('the multi-agent setup is off by default, so the lead gets no agent rules', () => {
  assert.doesNotMatch(machine().start(project()), /Çoklu ajan düzeni/);
});

test('multiagent on gives the lead the balanced role table at session start', () => {
  const m = machine();
  const root = project();
  m.run(root, ['on']);
  const text = m.start(root);
  assert.match(text, /Çoklu ajan düzeni \(açık · Dengeli\)/);
  assert.match(text, /\| Uygulama \| [^|]+ \| Sonnet \| medium \|/);
  assert.match(text, /en fazla 4 ajan/);
});

test('multiagent off takes the rules away and keeps the chosen balance for next time', () => {
  const m = machine();
  const root = project();
  m.run(root, ['on', 'kalite']);
  m.run(root, ['off']);
  assert.doesNotMatch(m.start(root), /Çoklu ajan düzeni/);
  m.run(root, ['on']);
  assert.match(m.start(root), /Çoklu ajan düzeni \(açık · Kalite\)/);
});

test('multiagent set changes one role, keeps the others and makes the balance custom', () => {
  const m = machine();
  const root = project();
  m.run(root, ['on', 'maliyet']);
  m.run(root, ['set', 'uygulama', 'opus', 'high']);
  const text = m.start(root);
  assert.match(text, /\(açık · Özel\)/);
  assert.match(text, /\| Uygulama \| [^|]+ \| Opus \| high \|/);
  assert.match(text, /\| İnceleme \| [^|]+ \| Sonnet \| high \|/);
});

test('multiagent role gives an agent another role, and the lead is told', () => {
  const m = machine();
  const root = project();
  m.run(root, ['on']);
  m.run(root, ['role', 'architect', 'uygulama']);
  assert.match(m.start(root), /architect → Uygulama/);
});

test('multiagent set paralel and yukselt change the rules the lead gets', () => {
  const m = machine();
  const root = project();
  m.run(root, ['on']);
  m.run(root, ['set', 'paralel', '2']);
  m.run(root, ['set', 'yukselt', 'off']);
  const text = m.start(root);
  assert.match(text, /en fazla 2 ajan/);
  assert.doesNotMatch(text, /bir üst effort/);
});

function leadRules() {
  const m = machine();
  const root = project();
  m.run(root, ['on']);
  return m.start(root);
}

test('the lead is told to do small changes and short questions itself, without agents', () => {
  assert.match(leadRules(), /birkaç satırlık[^\n]*ajan açma/);
});

test('the lead is told to keep writing agents on separate files and to change shared manifests itself', () => {
  const text = leadRules();
  assert.match(text, /Yazan her ajanın dosyaları ayrı/);
  assert.match(text, /kilit dosyalarını[^\n]*yalnız sen/);
});

test('the lead is told to end with which agent did what and how it was checked', () => {
  assert.match(leadRules(), /hangi işi hangi ajan yaptı, nasıl doğrulandı/);
});

test('a project follows the computer default until it sets its own', () => {
  const m = machine();
  const first = project();
  const second = project();
  m.run(first, ['default', 'on', 'maliyet']);
  assert.match(m.start(second), /\(açık · Maliyet\)/);
  m.run(second, ['on', 'kalite']);
  assert.match(m.start(second), /\(açık · Kalite\)/);
  assert.match(m.start(first), /\(açık · Maliyet\)/);
});

test('multiagent status shows whether it is on and each role', () => {
  const m = machine();
  const root = project();
  m.run(root, ['on']);
  const out = m.run(root, ['status']);
  assert.match(out, /açık · Dengeli/);
  assert.match(out, /Uygulama\s+Sonnet · medium/);
});

test('multiagent refuses a model it does not know and lists the ones it takes', () => {
  const m = machine();
  const res = cli(project(), ['multiagent', 'set', 'uygulama', 'gpt', 'high'], { env: m.env });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /opus/);
});

// Enter on "Durum" turns it on; on "Denge" it opens the balances (↓ to Kalite); ↑↑ wraps to the confirm row.
test('the settings screen changes a row with Enter and saves only after "Emin misiniz?"', () => {
  const keys = [['\r', 'return'], ['', 'down'], ['\r', 'return'], ['', 'down'], ['\r', 'return'], ['', 'up'], ['', 'up'], ['\r', 'return'], ['e', 'e']];
  const res = spawnSync(process.execPath, [SETTINGS_DRIVER], { encoding: 'utf8', env: { ...process.env, KEYS: JSON.stringify(keys) }, timeout: 10000 });
  assert.equal(res.status, 0, res.stderr);
  const chosen = JSON.parse(res.stdout);
  assert.equal(chosen.on, true);
  assert.equal(chosen.profile, 'kalite');
  assert.deepEqual(chosen.roles.uygulama, { model: 'inherit', effort: 'high' });
});

test("roleOf places agents by their names and lets the user's assignment win", () => {
  assert.equal(roleOf('legacies:code-reviewer'), 'inceleme');
  assert.equal(roleOf('Explore'), 'arama');
  assert.equal(roleOf('rust-build-resolver'), 'uygulama');
  assert.equal(roleOf('architect'), 'tasarim');
  assert.equal(roleOf('architect', { architect: 'uygulama' }), 'uygulama');
});
