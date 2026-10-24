import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, exists, readJson, readText } from './util.mjs';

export const MEMORY_DIRNAME = '.legacies';

// Walks up to the nearest folder that holds .legacies or .git.
// It spawns no git process, so it stays cheap enough for every hook call.
export function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (exists(path.join(dir, MEMORY_DIRNAME)) || exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function memoryPaths(root) {
  const base = path.join(root, MEMORY_DIRNAME);
  return {
    root,
    base,
    project: path.join(base, 'PROJECT.md'),
    state: path.join(base, 'STATE.md'),
    memory: path.join(base, 'memory'),
    index: path.join(base, 'memory', 'INDEX.md'),
    sessions: path.join(base, 'sessions'),
    archive: path.join(base, 'sessions', 'archive'),
    runtime: path.join(base, 'state'),
    config: path.join(base, 'config.json'),
  };
}

export function hasMemory(root) {
  return root != null && exists(path.join(root, MEMORY_DIRNAME));
}

export function isGitRepo(root) {
  return root != null && exists(path.join(root, '.git'));
}

// Claude Code caps a hook's context at 10,000 characters; both budgets stay below it.
const DEFAULT_CONFIG = {
  startupBudget: 8000,
  compactBudget: 9000,
  promptContext: true,
  promptBudget: 2500,
  stopReminder: true,
  reminderMinFiles: 3,
  reminderIdleMinutes: 45,
  reminderCooldownMinutes: 30,
  keepSessionCards: 30,
};

// Without a memory folder (a session that only works in other projects) the defaults apply.
export function loadConfig(paths) {
  return { ...DEFAULT_CONFIG, ...((paths && readJson(paths.config, {})) || {}) };
}

export function git(root, args, { timeout = 3000 } = {}) {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout, windowsHide: true });
  if (res.error || res.status !== 0) return null;
  return res.stdout.trim();
}

export function gitHead(root) {
  return git(root, ['rev-parse', '--short=8', 'HEAD']);
}

export function commitsSince(root, sha) {
  const out = git(root, ['rev-list', '--count', `${sha}..HEAD`]);
  return out == null ? null : Number(out);
}

export function changedSince(root, sha) {
  const out = git(root, ['diff', '--name-only', `${sha}..HEAD`]);
  return out == null ? null : out.split('\n').filter(Boolean);
}

export function statusShort(root, limit = 20) {
  const out = git(root, ['status', '--short', '--untracked-files=normal']);
  if (out == null) return [];
  return out
    .split('\n')
    .filter((line) => line && !line.slice(3).startsWith(`${MEMORY_DIRNAME}/`))
    .slice(0, limit);
}

export function logSince(root, since, limit = 15) {
  const out = git(root, ['log', `--since=${since}`, `--max-count=${limit}`, '--format=%h %s']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function excludeFile(root) {
  const rel = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  return rel ? path.resolve(root, rel) : null;
}

// Hides paths through .git/info/exclude, which is local to this clone, so no tracked file changes.
// `probe` is a path the pattern must cover; when git already ignores it, nothing is written.
export function excludePattern(root, pattern, probe) {
  if (git(root, ['check-ignore', '-q', '--no-index', probe]) !== null) return 'zaten git tarafından yok sayılıyor';
  const file = excludeFile(root);
  if (!file) return 'exclude dosyası bulunamadı';
  const text = readText(file, '');
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`, 'utf8');
  return `.git/info/exclude dosyasına eklendi (commit'lenen hiçbir dosya değişmedi)`;
}

// Removes only the exact line legacies added; the user's own exclude rules stay.
export function removeExcludePattern(root, pattern) {
  const file = excludeFile(root);
  if (!file || !exists(file)) return false;
  const lines = readText(file, '').split('\n');
  const kept = lines.filter((line) => line.trim() !== pattern);
  if (kept.length === lines.length) return false;
  fs.writeFileSync(file, kept.join('\n'), 'utf8');
  return true;
}
