import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, gitRepo, tempDir, write } from './helpers.mjs';

const enabledPlugins = (on) => JSON.stringify({ enabledPlugins: { 'legacies@legacies': on } });

test('doctor says the plugin is on in this project and which settings file turns it on', () => {
  const root = gitRepo();
  write(root, '.claude/settings.local.json', enabledPlugins(true));
  const res = cli(root, ['doctor']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Eklenti \(bu proje\): açık — \.claude\/settings\.local\.json/);
});

test('doctor follows Claude Code: this computer\'s setting wins over the shared one', () => {
  const root = gitRepo();
  write(root, '.claude/settings.json', enabledPlugins(true));
  write(root, '.claude/settings.local.json', enabledPlugins(false));
  const res = cli(root, ['doctor']);
  assert.match(res.stdout, /Eklenti \(bu proje\): kapalı — \.claude\/settings\.local\.json/);
});

test('doctor says the plugin is not installed when no settings name it, and how to install it', () => {
  const res = cli(gitRepo(), ['doctor']);
  assert.match(res.stdout, /Eklenti \(bu proje\): kurulu değil.*legacies setup/);
});

test('doctor flags a user-wide install, since legacies is installed per project', () => {
  const config = tempDir('legacies-config-');
  write(config, 'settings.json', enabledPlugins(true));
  const res = cli(gitRepo(), ['doctor'], { env: { CLAUDE_CONFIG_DIR: config } });
  assert.match(res.stdout, /Eklenti \(bu proje\): kullanıcı genelinde açık.*⚠.*legacies setup/);
});
