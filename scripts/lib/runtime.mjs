import fs from 'node:fs';
import path from 'node:path';
import { appendLine, claudeConfigDir, ensureDir, readJson, readText, samePath, writeAtomic } from './util.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function safeId(sessionId) {
  return String(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export function ledgerFile(paths, sessionId) {
  return path.join(paths.runtime, 'sessions', `${safeId(sessionId)}.jsonl`);
}

export function checkpointFile(paths, sessionId) {
  return path.join(paths.runtime, 'checkpoints', `${safeId(sessionId)}.md`);
}

export function compactSummaryFile(paths, sessionId) {
  return path.join(paths.runtime, 'checkpoints', `${safeId(sessionId)}.summary.md`);
}

export function currentSessionFile(paths) {
  return path.join(paths.runtime, 'current-session.json');
}

// Append-only, so concurrent hook processes never overwrite each other's events.
export function record(paths, sessionId, event) {
  appendLine(ledgerFile(paths, sessionId), JSON.stringify({ t: Date.now(), ...event }));
}

export function readLedger(paths, sessionId) {
  const text = readText(ledgerFile(paths, sessionId), '');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A torn last line from a killed process is skipped.
    }
  }
  return events;
}

export function summarizeLedger(events) {
  const of = (kind) => events.filter((e) => e.kind === kind).map((e) => e.t);
  const starts = of('start');
  return {
    startedAt: starts.length ? Math.min(...starts) : events.length ? events[0].t : null,
    edits: events.filter((e) => e.kind === 'edit'),
    outside: events.filter((e) => e.kind === 'edit-outside'),
    reminders: of('reminder'),
    handoffs: of('handoff'),
    skips: of('skip'),
    graphUpdates: of('graph-update'),
  };
}

// What was already injected since the context last started fresh (session start or compaction).
export function deliveredSince(events) {
  let epoch = 0;
  for (const e of events) if (e.kind === 'start') epoch = Math.max(epoch, e.t);
  const keys = new Set();
  for (const e of events) {
    if (e.kind === 'delivered' && e.t >= epoch && Array.isArray(e.keys)) for (const k of e.keys) keys.add(k);
  }
  return keys;
}

// Claude Code names the data folder <plugin>-<marketplace>; the CLI outside a hook has no CLAUDE_PLUGIN_DATA.
export function pluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(claudeConfigDir(), 'plugins', 'data', 'legacies-legacies');
}

const registryFile = () => path.join(pluginDataDir(), 'projects.json');

// Projects that have memory, so the uninstaller can offer to remove it; the plugin never scans the disk.
export function registerProject(root, flags = {}) {
  try {
    const data = readJson(registryFile(), { projects: {} }) || { projects: {} };
    const key = path.resolve(root);
    const before = JSON.stringify(data.projects[key] || null);
    data.projects[key] = { ...(data.projects[key] || {}), ...flags, seenAt: data.projects[key]?.seenAt || new Date().toISOString() };
    if (JSON.stringify(data.projects[key]) !== before) writeAtomic(registryFile(), JSON.stringify(data, null, 2));
  } catch {
    // The registry is a convenience; a write failure must never break a hook.
  }
}

export function registeredProjects() {
  const data = readJson(registryFile(), { projects: {} }) || { projects: {} };
  return Object.keys(data.projects || {});
}

// Projects a session works in besides the one it started in: added with /add-dir, opened as part of a
// workspace, or edited. Kept per session in the plugin data folder, because the start folder may have
// no memory of its own.
const activeFile = (sessionId) => path.join(pluginDataDir(), 'sessions', `${safeId(sessionId)}.json`);

const readActive = (sessionId) => (sessionId && readJson(activeFile(sessionId), null)) || { start: null, projects: [] };

function writeActive(sessionId, data) {
  try {
    writeAtomic(activeFile(sessionId), JSON.stringify(data));
    return true;
  } catch {
    // Tracking is a convenience; a write failure must never break a hook.
    return false;
  }
}

export function activeProjects(sessionId) {
  return readActive(sessionId).projects || [];
}

export function addActiveProject(sessionId, root, via) {
  if (!sessionId || !root) return false;
  const data = readActive(sessionId);
  const key = path.resolve(root);
  if ((data.projects || []).some((p) => samePath(p.root, key))) return false;
  return writeActive(sessionId, { ...data, projects: [...(data.projects || []), { root: key, via, at: new Date().toISOString() }] });
}

// Where the session started, so a later prompt can tell that it moved into another project (/cd).
export function markSessionStart(sessionId, root) {
  if (!sessionId || !root) return false;
  const data = readActive(sessionId);
  return data.start ? false : writeActive(sessionId, { ...data, start: path.resolve(root) });
}

export function sessionStartRoot(sessionId) {
  return readActive(sessionId).start || null;
}

export function pruneActiveSessions(maxAgeDays = 14) {
  const dir = path.join(pluginDataDir(), 'sessions');
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    try {
      if (fs.statSync(path.join(dir, name)).mtimeMs < cutoff) fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // Ignore files that vanish mid-scan.
    }
  }
}

// Keeps only the newest lines, so the error log can never grow without bound.
export function logError(err, where = '') {
  try {
    const file = path.join(pluginDataDir(), 'errors.log');
    const line = `[${new Date().toISOString()}] ${where} ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`;
    const lines = readText(file, '').split('\n').filter(Boolean).slice(-49);
    lines.push(line);
    writeAtomic(file, `${lines.join('\n')}\n`);
  } catch {
    // Logging must never break a hook.
  }
}

// Deletes per-session runtime files older than maxAgeDays; cards and notes are never touched here.
export function pruneRuntime(paths, maxAgeDays = 14) {
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  let removed = 0;
  for (const dir of [path.join(paths.runtime, 'sessions'), path.join(paths.runtime, 'checkpoints')]) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) {
          fs.rmSync(file, { force: true });
          removed += 1;
        }
      } catch {
        // Ignore files that vanish mid-scan.
      }
    }
  }
  return removed;
}

export function writeCurrentSession(paths, info) {
  ensureDir(paths.runtime);
  writeAtomic(currentSessionFile(paths), JSON.stringify(info));
}
