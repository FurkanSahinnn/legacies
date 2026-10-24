import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { excludePattern, git, isGitRepo, removeExcludePattern } from './project.mjs';
import { dateStamp, ensureDir, exists, readJson, readText, writeAtomic } from './util.mjs';

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

// ~/.local/bin is already on PATH on this setup (uv's installer adds it).
export function launcherDir() {
  return process.env.LEGACIES_BIN_DIR || path.join(os.homedir(), '.local', 'bin');
}

const EVENTS = [
  ['SessionStart', null, 10, 'session-start'],
  ['UserPromptSubmit', null, 10, 'user-prompt-submit'],
  ['PostToolUse', 'apply_patch|Edit|Write|MultiEdit|NotebookEdit', 5, 'post-tool-use'],
  ['PreCompact', null, 15, 'pre-compact'],
  ['Stop', null, 10, 'stop'],
  // Codex caps SessionEnd hooks at 3 seconds.
  ['SessionEnd', null, 3, 'session-end'],
];

const isOurs = (h) => typeof h.command === 'string' && h.command.includes('legacies.mjs') && h.command.includes('--harness codex');

export function hookCommand(scriptPath, event) {
  return `node "${scriptPath.replace(/\\/g, '/')}" hook ${event} --harness codex`;
}

// Returns a new hooks.json object: other tools' hooks stay, earlier legacies entries are replaced.
export function planCodexHooks(existing, scriptPath) {
  const data = existing && typeof existing === 'object' && !Array.isArray(existing) ? structuredClone(existing) : {};
  if (!data.hooks || typeof data.hooks !== 'object') data.hooks = {};
  const hooks = data.hooks;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length > 0);
    if (hooks[event].length === 0) delete hooks[event];
  }
  for (const [event, matcher, timeout, arg] of EVENTS) {
    const command = hookCommand(scriptPath, arg);
    const group = { hooks: [{ type: 'command', command, commandWindows: command, timeout }] };
    if (matcher) group.matcher = matcher;
    (hooks[event] ||= []).push(group);
  }
  return data;
}

export function removeCodexHooks(existing) {
  const data = structuredClone(existing || {});
  for (const [event, groups] of Object.entries(data.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    data.hooks[event] = groups.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length);
    if (data.hooks[event].length === 0) delete data.hooks[event];
  }
  return data;
}

export function hasOurHooks(data) {
  return Object.values((data && data.hooks) || {}).some((groups) => Array.isArray(groups) && groups.some((g) => (g.hooks || []).some(isOurs)));
}

// The protocol block earlier versions wrote into ~/.codex/AGENTS.md; the SessionStart hook now carries it.
const BLOCK_RE = /<!-- legacies:start -->[\s\S]*?<!-- legacies:end -->\n?/;

export function removeAgentsBlock(text) {
  return String(text || '').replace(BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function backup(file) {
  if (!exists(file)) return null;
  const target = `${file}.bak-legacies-${dateStamp().replace(/-/g, '')}`;
  if (!exists(target)) fs.copyFileSync(file, target);
  return target;
}

// An sh shim serves macOS, Linux and Git Bash; Windows also gets legacies.cmd for cmd and PowerShell.
export function writeLaunchers(scriptPath) {
  const dir = launcherDir();
  ensureDir(dir);
  const forward = scriptPath.replace(/\\/g, '/');
  if (process.platform === 'win32') writeAtomic(path.join(dir, 'legacies.cmd'), `@echo off\r\nnode "${scriptPath}" %*\r\n`);
  writeAtomic(path.join(dir, 'legacies'), `#!/bin/sh\nexec node "${forward}" "$@"\n`);
  try {
    fs.chmodSync(path.join(dir, 'legacies'), 0o755);
  } catch {
    // chmod is a no-op on Windows.
  }
  return dir;
}

export function launcherFiles(scriptPath) {
  const forward = scriptPath.replace(/\\/g, '/');
  return ['legacies.cmd', 'legacies']
    .map((name) => path.join(launcherDir(), name))
    .filter((file) => {
      const text = readText(file, '');
      return text.includes(scriptPath) || text.includes(forward);
    });
}

export function readJsonStrict(file) {
  const text = readText(file);
  if (text == null) return {};
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error(`${file} geçerli JSON değil; dokunmadan duruyorum. Önce dosyayı düzelt.`);
  }
}

// Codex's user-level files; legacies only reads them, and removes what earlier versions wrote there.
export function codexStatus() {
  const hooksFile = path.join(codexHome(), 'hooks.json');
  const agentsFile = path.join(codexHome(), 'AGENTS.md');
  let hooks = {};
  let hooksValid = true;
  try {
    hooks = readJsonStrict(hooksFile);
  } catch {
    hooksValid = false;
  }
  return {
    home: codexHome(),
    exists: exists(codexHome()),
    hooksFile,
    agentsFile,
    hooksValid,
    ourHooks: hasOurHooks(hooks),
    agentsBlock: readText(agentsFile, '').includes('<!-- legacies:start -->'),
    hooksEnabled: codexHooksEnabled(),
  };
}

export const PROJECT_CODEX_HOOKS = '.codex/hooks.json';
const CODEX_EXCLUDE = `/${PROJECT_CODEX_HOOKS}`;

export const projectCodexFile = (root) => path.join(root, '.codex', 'hooks.json');

// A hooks.json the team commits is theirs; legacies never writes into a tracked file.
export const codexFileTracked = (root) => isGitRepo(root) && git(root, ['ls-files', '--error-unmatch', PROJECT_CODEX_HOOKS]) !== null;

export const hasProjectCodex = (root) => hasOurHooks(readJson(projectCodexFile(root), {}));

// Codex reads <repo>/.codex/hooks.json only in a project it trusts, and runs each hook only after /hooks
// approves it. The file holds this machine's script path, so it stays out of git.
export function installProjectCodex(scriptPath, root) {
  if (codexFileTracked(root)) throw new Error(`${PROJECT_CODEX_HOOKS} git'te takip ediliyor; legacies takip edilen dosyalara yazmaz.`);
  const file = projectCodexFile(root);
  writeAtomic(file, `${JSON.stringify(planCodexHooks(readJsonStrict(file), scriptPath), null, 2)}\n`);
  return { file, git: isGitRepo(root) ? excludePattern(root, CODEX_EXCLUDE, PROJECT_CODEX_HOOKS) : null };
}

export function uninstallProjectCodex(root) {
  const file = projectCodexFile(root);
  const current = readJsonStrict(file);
  if (!hasOurHooks(current)) return false;
  const rest = removeCodexHooks(current);
  if (Object.keys(rest.hooks).length || Object.keys(rest).length > 1) writeAtomic(file, `${JSON.stringify(rest, null, 2)}\n`);
  else {
    fs.rmSync(file, { force: true });
    if (!fs.readdirSync(path.dirname(file)).length) fs.rmdirSync(path.dirname(file));
  }
  if (isGitRepo(root)) removeExcludePattern(root, CODEX_EXCLUDE);
  return true;
}

// Earlier versions wrote hooks and a protocol block into Codex's user config, which runs in every project.
export function removeGlobalCodex() {
  const status = codexStatus();
  if (status.ourHooks) {
    const current = readJsonStrict(status.hooksFile);
    backup(status.hooksFile);
    writeAtomic(status.hooksFile, `${JSON.stringify(removeCodexHooks(current), null, 2)}\n`);
  }
  if (status.agentsBlock) {
    const rest = removeAgentsBlock(readText(status.agentsFile, ''));
    if (rest.trim()) writeAtomic(status.agentsFile, rest);
    else fs.rmSync(status.agentsFile, { force: true });
  }
  return status;
}

export function removeLaunchers(scriptPath) {
  const forward = scriptPath.replace(/\\/g, '/');
  for (const name of ['legacies.cmd', 'legacies']) {
    const file = path.join(launcherDir(), name);
    const text = readText(file, '');
    if (text.includes(scriptPath) || text.includes(forward)) fs.rmSync(file, { force: true });
  }
}

export function codexHooksEnabled() {
  const config = readText(path.join(codexHome(), 'config.toml'), '');
  return /^\s*hooks\s*=\s*true\b/m.test(config);
}

export function onPath(dir) {
  const norm = (p) => path.resolve(p).toLowerCase();
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .some((p) => p && norm(p.replace(/^"|"$/g, '')) === norm(dir));
}
