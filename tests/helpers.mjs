import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'legacies.mjs');

// Each test file runs in its own process; the folders it made go when that process exits, so test runs
// leave nothing behind in the system temp folder (they once piled up to 17,000 folders).
const created = [];
process.on('exit', () => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // A detached child process may still hold it open; the system's temp cleanup takes it later.
    }
  }
});

export function tempDir(prefix = 'legacies-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function run(cwd, cmd, args) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

export function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export function commit(root, message) {
  run(root, 'git', ['add', '-A']);
  run(root, 'git', ['commit', '-q', '-m', message]);
}

export function gitRepo() {
  const dir = tempDir();
  run(dir, 'git', ['init', '-q', '-b', 'main']);
  run(dir, 'git', ['config', 'user.email', 'test@example.com']);
  run(dir, 'git', ['config', 'user.name', 'Test']);
  write(dir, 'src/auth/session.ts', 'export function getUserSession() { return null; }\n');
  write(dir, 'README.md', '# demo\n');
  commit(dir, 'init');
  return dir;
}

// Every call gets an isolated plugin data dir and a fixed session id, never the developer's real ones.
export function cli(cwd, args, { input, env = {}, pluginData } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: pluginData || tempDir('legacies-data-'),
      CLAUDE_CODE_SESSION_ID: 'test-session-0001',
      LEGACIES_DISABLED: '',
      ...env,
    },
  });
}

export function hook(cwd, event, payload = {}, options = {}) {
  const res = cli(cwd, ['hook', event], { ...options, input: JSON.stringify({ cwd, session_id: 'test-session-0001', ...payload }) });
  const text = res.stdout.trim();
  return { ...res, json: text ? JSON.parse(text) : null };
}

export function initMemory(root) {
  const res = cli(root, ['init']);
  if (res.status !== 0) throw new Error(res.stderr);
  return path.join(root, '.legacies');
}
