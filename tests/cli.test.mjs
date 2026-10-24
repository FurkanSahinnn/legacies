import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, commit, gitRepo, initMemory, run, write } from './helpers.mjs';

test('help names the usage guide, which exists', () => {
  const res = cli(gitRepo(), ['help']);
  const guide = /Kullanım rehberi: (.+[\\/]docs[\\/]KULLANIM\.md)/.exec(res.stdout);
  assert.ok(guide, res.stdout);
  assert.ok(fs.existsSync(guide[1]), guide[1]);
});

test('init builds the layout, hides it from git and is idempotent', () => {
  const root = gitRepo();
  const first = cli(root, ['init']);
  assert.equal(first.status, 0, first.stderr);
  for (const rel of ['PROJECT.md', 'STATE.md', 'memory/INDEX.md', 'memory/gotcha', 'memory/decision', 'sessions', 'state']) {
    assert.ok(fs.existsSync(path.join(root, '.legacies', rel)), rel);
  }
  assert.equal(run(root, 'git', ['status', '--porcelain']), '', 'no tracked or untracked change may appear');
  const second = cli(root, ['init']);
  assert.match(second.stdout, /zaten/);
  const exclude = fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.match(/\/\.legacies\//g).length, 1);
});

test('add writes a note, refuses duplicates and search finds it by identifier and inflection', () => {
  const root = gitRepo();
  initMemory(root);
  const add = cli(root, ['add', '--type', 'gotcha', '--title', 'Oturum çerezi server client ister', '--paths', 'src/auth/**', '--summary', 'RSC içinde tarayıcı istemcisi oturumu kaybeder'], {
    input: 'getUserSession sunucu tarafında createServerClient ile çağrılmalı.\n',
  });
  assert.equal(add.status, 0, add.stderr);
  const index = fs.readFileSync(path.join(root, '.legacies', 'memory', 'INDEX.md'), 'utf8');
  assert.match(index, /Oturum çerezi server client ister/);

  const dup = cli(root, ['add', '--type', 'gotcha', '--title', 'Oturum çerezi server client ister', '--text', 'x']);
  assert.equal(dup.status, 2);

  const byIdentifier = cli(root, ['search', 'getUserSession']);
  assert.match(byIdentifier.stdout, /Oturum çerezi server client ister/);
  const byTurkish = cli(root, ['search', 'oturumunu', 'nerede', 'kaybediyor']);
  assert.match(byTurkish.stdout, /Oturum çerezi/);
  const none = cli(root, ['search', 'kubernetes']);
  assert.match(none.stdout, /eşleşme yok/);
});

test('stale flags a note after its code changes and verify clears it', () => {
  const root = gitRepo();
  initMemory(root);
  cli(root, ['add', '--type', 'convention', '--title', 'Auth logic lives in src/auth', '--paths', 'src/auth/**', '--text', 'x']);
  assert.match(cli(root, ['stale']).stdout, /Bayat not yok/);

  write(root, 'src/auth/session.ts', 'export function getUserSession() { return 1; }\n');
  commit(root, 'change auth');
  const stale = cli(root, ['stale']);
  assert.match(stale.stdout, /Auth logic lives in src\/auth/);
  assert.match(stale.stdout, /src\/auth\/session\.ts/);

  const verify = cli(root, ['verify', '.legacies/memory/convention/auth-logic-lives-in-src-auth.md']);
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(cli(root, ['stale']).stdout, /Bayat not yok/);
});

test('handoff writes one card per session and --skip records the choice', () => {
  const root = gitRepo();
  initMemory(root);
  const a = cli(root, ['handoff'], { input: '## Hedef\nGiriş sayfası\n' });
  assert.equal(a.status, 0, a.stderr);
  const b = cli(root, ['handoff', '--text', '## Hedef\nGüncellendi']);
  assert.equal(b.status, 0, b.stderr);
  const cards = fs.readdirSync(path.join(root, '.legacies', 'sessions')).filter((f) => f.endsWith('.md'));
  assert.equal(cards.length, 1);
  assert.match(fs.readFileSync(path.join(root, '.legacies', 'sessions', cards[0]), 'utf8'), /Güncellendi/);
  assert.equal(cli(root, ['handoff', '--skip', 'typo']).status, 0);
  assert.equal(cli(root, ['handoff', '--text', '   ']).status, 2);
});

test('commands outside a memory project fail with a clear message', () => {
  const root = gitRepo();
  const res = cli(root, ['search', 'x']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /legacies init/);
});
