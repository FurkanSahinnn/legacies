#!/usr/bin/env node
// Maintainer tool: times every hook the way Claude Code runs it (a fresh node process per call)
// against a throwaway repository with a realistic memory. Usage: npm run bench:hooks [-- --runs 15]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'legacies.mjs');
const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') + 1]) || 15;
const NOTE_COUNT = 40;
const SOURCE_FILES = 300;

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const root = tmp('legacies-bench-');
const env = { ...process.env, CLAUDE_PLUGIN_DATA: tmp('legacies-bench-data-'), CLAUDE_CONFIG_DIR: tmp('legacies-bench-config-'), CLAUDE_CODE_SESSION_ID: 'bench-session', LEGACIES_DISABLED: '' };
const sh = (cmd, cmdArgs, input) => spawnSync(cmd, cmdArgs, { cwd: root, env, input, encoding: 'utf8', windowsHide: true });

function seed() {
  sh('git', ['init', '-q', '-b', 'main']);
  sh('git', ['config', 'user.email', 'bench@example.com']);
  sh('git', ['config', 'user.name', 'bench']);
  for (let i = 0; i < SOURCE_FILES; i += 1) {
    const file = path.join(root, 'src', `feature${i % 20}`, `module${i}.ts`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `export function handler${i}() { return ${i}; }\n`);
  }
  sh(process.execPath, [CLI, 'init']);
  const types = ['decision', 'gotcha', 'convention', 'howto', 'reference'];
  for (let i = 0; i < NOTE_COUNT; i += 1) {
    sh(process.execPath, [CLI, 'add', '--type', types[i % types.length], '--title', `Feature ${i % 20} handler ${i} keeps its cache per user`, '--paths', `src/feature${i % 20}/**`, '--text', 'Why and where; how to check it.']);
  }
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-qm', 'seed']);
}

const PAYLOADS = {
  'session-start': { source: 'startup' },
  'user-prompt-submit': { prompt: 'feature 7 handler cache per user neden bozuluyor' },
  'pre-tool-use': { tool_name: 'Bash', tool_input: { command: 'npm test' } },
  'post-tool-use': { tool_name: 'Edit', tool_input: { file_path: 'src/feature3/module3.ts' } },
  stop: {},
};

function time(event) {
  const input = JSON.stringify({ cwd: root, session_id: 'bench-session', ...PAYLOADS[event] });
  const samples = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = process.hrtime.bigint();
    const res = sh(process.execPath, [CLI, 'hook', event], input);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (res.status !== 0) throw new Error(`${event} exited ${res.status}: ${res.stderr}`);
  }
  samples.sort((a, b) => a - b);
  const at = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return { event, p50: at(0.5), p95: at(0.95), max: samples[samples.length - 1] };
}

seed();
const rows = Object.keys(PAYLOADS).map(time);
process.stdout.write(`${NOTE_COUNT} notes, ${SOURCE_FILES} source files, ${RUNS} runs per hook (Node ${process.versions.node}, ${process.platform})\n`);
process.stdout.write(`${'hook'.padEnd(20)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'max ms'.padStart(9)}\n`);
for (const r of rows) process.stdout.write(`${r.event.padEnd(20)}${r.p50.toFixed(0).padStart(9)}${r.p95.toFixed(0).padStart(9)}${r.max.toFixed(0).padStart(9)}\n`);
process.stdout.write('pre-tool-use runs on every shell and edit call: its cost is mostly Node start-up.\n');
fs.rmSync(root, { recursive: true, force: true });
