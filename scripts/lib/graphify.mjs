import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { graphDir } from './codeindex.mjs';
import { pluginDataDir } from './runtime.mjs';
import { exists } from './util.mjs';

// The code graph comes from graphify (https://github.com/Graphify-Labs/graphify), pinned and installed by
// legacies' setup with uv. legacies runs only its graph-building commands and answers questions itself;
// graphify's own installer (CLAUDE.md block, PreToolUse hooks, skills) is never run.
export const GRAPHIFY_VERSION = '0.9.93';
export const GRAPHIFY_SPEC = `graphifyy[sql]==${GRAPHIFY_VERSION}`;
// AST only: without --code-only, extract would try an LLM backend on documents.
export const BUILD_ARGS = ['extract', '.', '--code-only'];
export const UPDATE_ARGS = ['update', '.'];

// legacies keeps its own graphify in the plugin data folder: a graphify the user installed is never
// replaced or removed, the tested version is the one that runs, and it leaves with the plugin data.
export const graphifyHome = () => path.join(pluginDataDir(), 'graphify');
export const graphifyToolEnv = () => ({ ...process.env, UV_TOOL_DIR: path.join(graphifyHome(), 'tools'), UV_TOOL_BIN_DIR: path.join(graphifyHome(), 'bin') });

// How to run graphify: a test double (LEGACIES_GRAPHIFY_BIN, a .mjs script), or legacies' own copy.
export function graphifyCommand() {
  const override = process.env.LEGACIES_GRAPHIFY_BIN;
  if (override === '__none__') return null;
  if (override) return { cmd: process.execPath, pre: [override] };
  const exe = path.join(graphifyHome(), 'bin', process.platform === 'win32' ? 'graphify.exe' : 'graphify');
  return exists(exe) ? { cmd: exe, pre: [] } : null;
}

// No LLM backend, no tips or hosted-platform notice, no auto refresh or query log, deterministic ids,
// and the graph kept in .legacies/graph instead of a graphify-out folder in the project.
export function graphifyEnv(paths) {
  return {
    ...process.env,
    GRAPHIFY_BACKEND: 'none',
    GRAPHIFY_NO_TIPS: '1',
    GRAPHIFY_NO_CTA: '1',
    GRAPHIFY_NO_AUTO_REFRESH: '1',
    GRAPHIFY_QUERY_LOG_DISABLE: '1',
    PYTHONHASHSEED: '0',
    GRAPHIFY_OUT: graphDir(paths),
  };
}

export function runGraphify(paths, args, { inherit = false, timeout = 30 * 60 * 1000 } = {}) {
  const command = graphifyCommand();
  if (!command) return null;
  return spawnSync(command.cmd, [...command.pre, ...args], {
    cwd: paths.root,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    stdio: inherit ? 'inherit' : 'pipe',
    env: graphifyEnv(paths),
  });
}

// Detached, so building or refreshing the graph never delays the session.
export function startGraphify(paths, args) {
  const command = graphifyCommand();
  if (!command) return false;
  fs.mkdirSync(graphDir(paths), { recursive: true });
  const child = spawn(command.cmd, [...command.pre, ...args], {
    cwd: paths.root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: graphifyEnv(paths),
  });
  child.on('error', () => {});
  child.unref();
  return true;
}
