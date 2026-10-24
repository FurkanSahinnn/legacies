import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cli, gitRepo, hook, initMemory, tempDir, write } from './helpers.mjs';

const context = (res) => res.json && res.json.hookSpecificOutput && res.json.hookSpecificOutput.additionalContext;

test('session-start restores the executable bit that a checkout of a Windows commit drops from bin/legacies', { skip: process.platform === 'win32' }, () => {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const copy = tempDir('legacies-plugin-');
  for (const dir of ['scripts', 'bin']) fs.cpSync(path.join(source, dir), path.join(copy, dir), { recursive: true });
  const launcher = path.join(copy, 'bin', 'legacies');
  fs.chmodSync(launcher, 0o644);
  const root = gitRepo();
  const res = spawnSync(process.execPath, [path.join(copy, 'scripts', 'legacies.mjs'), 'hook', 'session-start'], {
    cwd: root,
    input: JSON.stringify({ cwd: root, session_id: 'test-session-0001', source: 'startup' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: tempDir('legacies-data-'), LEGACIES_DISABLED: '' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.statSync(launcher).mode & 0o111, 0o111);
});

test('session-start without memory shows the setup hint once per week', () => {
  const root = gitRepo();
  const pluginData = tempDir('legacies-data-');
  const first = hook(root, 'session-start', { source: 'startup' }, { pluginData });
  assert.match(context(first), /\/legacies:onboard/);
  const again = hook(root, 'session-start', { source: 'startup' }, { pluginData });
  assert.equal(again.json, null);
  assert.equal(hook(root, 'session-start', { source: 'compact' }, { pluginData: tempDir() }).json, null);
});

test('session-start with memory injects state, index and the newest card within budget', () => {
  const root = gitRepo();
  const base = initMemory(root);
  write(root, '.legacies/STATE.md', '# Güncel durum\n\n## Odak\nÖdeme akışını yeniden yazıyoruz.\n');
  cli(root, ['add', '--type', 'decision', '--title', 'Shopier webhook imzası zorunlu', '--paths', 'src/pay/**', '--text', 'Neden: sahte ödeme.']);
  cli(root, ['handoff', '--text', '## Sonraki adım\nwebhook testini yaz'], { env: { CLAUDE_CODE_SESSION_ID: 'older-session' } });
  const res = hook(root, 'session-start', { source: 'startup' });
  const text = context(res);
  assert.equal(res.status, 0);
  assert.match(text, /\[legacies\]/);
  assert.match(text, /Ödeme akışını yeniden yazıyoruz/);
  assert.match(text, /Shopier webhook imzası zorunlu/);
  assert.match(text, /webhook testini yaz/);
  assert.match(text, /PROJECT\.md henüz doldurulmamış/);
  assert.ok(text.length <= 8000, `length ${text.length}`);
  assert.ok(fs.existsSync(path.join(base, 'state', 'current-session.json')));
});

test('session-start tells Claude to translate a question in another language with legacies vocab', () => {
  const root = gitRepo();
  initMemory(root);
  const text = context(hook(root, 'session-start', { source: 'startup' }));
  assert.match(text, /`legacies vocab`/);
});

test("session-start tells Claude to write notes in the user's language and keep code names as they are", () => {
  const root = gitRepo();
  initMemory(root);
  const text = context(hook(root, 'session-start', { source: 'startup' }));
  assert.match(text, /Notları ve kartları kullanıcının dilinde yaz; kod adları, dosya yolları ve komutlar olduğu gibi kalır\./);
});

test('stop blocks once after enough edits, then respects stop_hook_active, cooldown and handoffs', () => {
  const root = gitRepo();
  initMemory(root);
  for (const f of ['src/a.ts', 'src/b.ts', 'src/c.ts']) hook(root, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } });
  hook(root, 'post-tool-use', { tool_name: 'Write', tool_input: { file_path: path.join(root, '.legacies', 'memory', 'x.md') } });

  const blocked = hook(root, 'stop', {});
  assert.equal(blocked.json.decision, 'block');
  assert.match(blocked.json.reason, /3 dosya/);
  assert.equal(hook(root, 'stop', { stop_hook_active: true }).json, null);
  assert.equal(hook(root, 'stop', {}).json, null, 'cooldown');

  const fresh = gitRepo();
  initMemory(fresh);
  for (const f of ['a.ts', 'b.ts', 'c.ts']) hook(fresh, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(fresh, f) } });
  cli(fresh, ['handoff', '--text', 'kart']);
  assert.equal(hook(fresh, 'stop', {}).json, null, 'a card written after the edits satisfies the reminder');
});

test('stop stays quiet for a single small edit and when the reminder is turned off', () => {
  const root = gitRepo();
  initMemory(root);
  hook(root, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/a.ts') } });
  assert.equal(hook(root, 'stop', {}).json, null);
  for (const f of ['b.ts', 'c.ts']) hook(root, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } });
  assert.equal(hook(root, 'stop', {}, { env: { LEGACIES_STOP_REMINDER: 'off' } }).json, null);
});

test('pre-compact checkpoints the session and session-start(compact) brings it back', () => {
  const root = gitRepo();
  initMemory(root);
  const transcript = path.join(tempDir(), 't.jsonl');
  const lines = [
    { type: 'user', origin: { kind: 'human' }, message: { content: 'Profil sayfasındaki yavaşlığı çöz' } },
    { type: 'user', isMeta: true, origin: { kind: 'peer' }, message: { content: 'Another Claude session sent a message: gizli' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: path.join(root, 'src/profile.tsx') } }] } },
  ];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n'));
  hook(root, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/profile.tsx') } });
  hook(root, 'pre-compact', { trigger: 'auto', transcript_path: transcript });
  hook(root, 'post-compact', { trigger: 'auto', compact_summary: 'Özet: profil sorgusu' });

  const checkpoint = fs.readFileSync(path.join(root, '.legacies', 'state', 'checkpoints', 'test-session-0001.md'), 'utf8');
  assert.match(checkpoint, /Profil sayfasındaki yavaşlığı çöz/);
  assert.doesNotMatch(checkpoint, /gizli/);
  assert.match(checkpoint, /src\/profile\.tsx/);

  const text = context(hook(root, 'session-start', { source: 'compact' }));
  assert.match(text, /sıkıştırıldı/);
  assert.match(text, /Sıkıştırma öncesi kontrol noktası/);
  assert.match(text, /Profil sayfasındaki yavaşlığı çöz/);
  assert.ok(text.length <= 9000, `length ${text.length}`);
});

test('session-end leaves an automatic card when edits happened and none was written', () => {
  const root = gitRepo();
  initMemory(root);
  hook(root, 'post-tool-use', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/x.ts') } });
  hook(root, 'post-compact', { compact_summary: 'Önceki özet metni' });
  hook(root, 'session-end', { reason: 'exit' });
  const cards = fs.readdirSync(path.join(root, '.legacies', 'sessions')).filter((f) => f.endsWith('.md'));
  assert.equal(cards.length, 1);
  const card = fs.readFileSync(path.join(root, '.legacies', 'sessions', cards[0]), 'utf8');
  assert.match(card, /auto: true/);
  assert.match(card, /src\/x\.ts/);
  assert.match(card, /Önceki özet metni/);
});

test('hooks are silent and exit 0 on bad input, outside projects and when disabled', () => {
  const root = gitRepo();
  initMemory(root);
  const bad = cli(root, ['hook', 'session-start'], { input: '{not json' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout.trim(), '');
  const outside = tempDir();
  assert.equal(hook(outside, 'session-start', { source: 'startup' }).json, null);
  assert.equal(hook(outside, 'stop', {}).json, null);
  const disabled = hook(root, 'session-start', { source: 'startup' }, { env: { LEGACIES_DISABLED: '1' } });
  assert.equal(disabled.json, null);
  assert.equal(cli(root, ['hook', 'unknown-event'], { input: '{}' }).status, 0);
});
