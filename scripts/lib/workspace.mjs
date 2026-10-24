// Workspaces: named groups of projects worked on together, such as a web client and its mobile app.
// A workspace has a memory of its own for what belongs to no single project: API contracts, shared
// decisions, migration plans. It lives on this machine only and outside every repository, like the
// projects' .legacies/ folders, and `legacies uninstall` leaves it in place.
import fs from 'node:fs';
import path from 'node:path';
import { claudeConfigDir, ensureDir, exists, readJson, samePath, writeAtomic } from './util.mjs';

const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const WORKSPACE_ENV = 'LEGACIES_WORKSPACE';
export const workspacesDir = () => path.join(claudeConfigDir(), 'legacies-workspaces');

export function validWorkspaceName(name) {
  return NAME.test(String(name || ''));
}

// The same shape as memoryPaths(), so search, notes, the index and cards work on a workspace unchanged.
export function workspacePaths(name) {
  const base = path.join(workspacesDir(), name);
  return {
    root: base,
    base,
    project: path.join(base, 'WORKSPACE.md'),
    state: path.join(base, 'STATE.md'),
    memory: path.join(base, 'memory'),
    index: path.join(base, 'memory', 'INDEX.md'),
    sessions: path.join(base, 'sessions'),
    archive: path.join(base, 'sessions', 'archive'),
    runtime: path.join(base, 'state'),
    config: path.join(base, 'config.json'),
    file: path.join(base, 'workspace.json'),
    migrations: path.join(base, 'migrations'),
    workspace: name,
  };
}

export function readWorkspace(name) {
  if (!validWorkspaceName(name)) return null;
  const data = readJson(workspacePaths(name).file);
  return data && Array.isArray(data.members) ? { name, ...data } : null;
}

export function listWorkspaces() {
  let names = [];
  try {
    names = fs.readdirSync(workspacesDir());
  } catch {
    return [];
  }
  return names.map(readWorkspace).filter(Boolean);
}

export function workspacesOf(root) {
  return root ? listWorkspaces().filter((w) => w.members.some((m) => samePath(m.path, root))) : [];
}

const template = (name) => `# ${name}

Bu çalışma alanının amacı, projelerin rolleri ve aralarındaki sözleşmeler (API, veri modeli, ortak kurallar) burada durur.
`;

export function addToWorkspace(name, roots) {
  if (!validWorkspaceName(name)) throw new Error(`Çalışma alanı adı küçük harf, rakam ve tire olmalı: ${name}`);
  const paths = workspacePaths(name);
  const current = readWorkspace(name);
  const members = current ? [...current.members] : [];
  const added = [];
  for (const root of roots) {
    if (members.some((m) => samePath(m.path, root))) continue;
    members.push({ path: path.resolve(root), label: path.basename(path.resolve(root)) });
    added.push(path.resolve(root));
  }
  ensureDir(paths.memory);
  writeAtomic(paths.file, `${JSON.stringify({ members, createdAt: current?.createdAt || new Date().toISOString() }, null, 2)}\n`);
  if (!exists(paths.project)) writeAtomic(paths.project, template(name));
  return { name, members, added, created: !current };
}

export function removeFromWorkspace(name, root) {
  const current = readWorkspace(name);
  if (!current) throw new Error(`"${name}" adında bir çalışma alanı yok`);
  const members = current.members.filter((m) => !samePath(m.path, root));
  if (members.length === current.members.length) throw new Error(`${root} bu çalışma alanının üyesi değil`);
  writeAtomic(workspacePaths(name).file, `${JSON.stringify({ members, createdAt: current.createdAt }, null, 2)}\n`);
  return members;
}

export function deleteWorkspace(name) {
  if (!readWorkspace(name)) throw new Error(`"${name}" adında bir çalışma alanı yok`);
  fs.rmSync(workspacePaths(name).base, { recursive: true, force: true });
}
