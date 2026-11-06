import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, gitRepo, hook, initMemory, tempDir } from './helpers.mjs';

const FAKE_GRAPHIFY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-graphify.mjs');
const EXE = process.platform === 'win32' ? 'graphify.exe' : 'graphify';

function project() {
  const root = gitRepo();
  initMemory(root);
  const log = path.join(tempDir('graphify-log-'), 'calls.jsonl');
  return { root, log, env: { LEGACIES_GRAPHIFY_BIN: FAKE_GRAPHIFY, FAKE_GRAPHIFY_LOG: log } };
}
const graphFile = (root) => path.join(root, '.legacies', 'graph', 'graph.json');
const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// An empty file named like graphify's executable; status only checks that it is there.
function placeExecutable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, EXE), '');
  return dir;
}

// The build runs detached, so the test waits for its result instead of sleeping a fixed time.
async function waitFor(check, timeoutMs = 15000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('session start builds the code graph in the background when the project has none', async () => {
  const { root, log, env } = project();
  hook(root, 'session-start', { source: 'startup' }, { env });
  await waitFor(() => fs.existsSync(graphFile(root)));
  const [build] = calls(log);
  assert.equal(build.cmd, 'extract');
  assert.deepEqual(build.args, ['.', '--code-only']);
  assert.equal(build.backend, 'none');
  assert.equal(path.resolve(build.out), path.resolve(root, '.legacies', 'graph'));
});

test('a second session does not start another build while one is under way', async () => {
  const { root, log, env } = project();
  const pending = { ...env, FAKE_GRAPHIFY_NO_GRAPH: '1' };
  hook(root, 'session-start', { source: 'startup' }, { env: pending });
  await waitFor(() => calls(log).length === 1);
  hook(root, 'session-start', { source: 'startup' }, { env: pending });
  assert.equal(calls(log).filter((c) => c.cmd === 'extract').length, 1);
});

test('a session does not start a graph update while another session is still running one', async () => {
  const { root, log, env } = project();
  fs.mkdirSync(path.dirname(graphFile(root)), { recursive: true });
  fs.writeFileSync(graphFile(root), JSON.stringify({ nodes: [], links: [] }));
  const release = path.join(tempDir('graphify-hold-'), 'release');
  const held = { ...env, FAKE_GRAPHIFY_HOLD: release };
  const editAndStop = (sid) => {
    hook(root, 'post-tool-use', { session_id: sid, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'a.ts') } }, { env: held });
    hook(root, 'stop', { session_id: sid }, { env: held });
  };
  const ledger = (sid) => path.join(root, '.legacies', 'state', 'sessions', `${sid}.jsonl`);
  const startedUpdate = (sid) => fs.existsSync(ledger(sid)) && fs.readFileSync(ledger(sid), 'utf8').includes('"graph-update"');
  const updates = () => calls(log).filter((c) => c.cmd === 'update').length;

  editAndStop('session-a');
  assert.ok(startedUpdate('session-a'));
  await waitFor(() => updates() === 1);

  editAndStop('session-b');
  assert.equal(startedUpdate('session-b'), false, 'the second session leaves the running update alone');

  fs.writeFileSync(release, '');
  await waitFor(() => {
    editAndStop('session-c');
    return startedUpdate('session-c');
  });
  await waitFor(() => updates() === 2);
});

test('graph status says how to install graphify when it is missing', () => {
  const { root } = project();
  const res = cli(root, ['graph', 'status'], { env: { LEGACIES_GRAPHIFY_BIN: '__none__' } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /graphify: kurulu değil/);
  assert.match(res.stdout, /legacies setup/);
});

test("graph status finds legacies' own graphify in the plugin data folder", () => {
  const { root } = project();
  const data = tempDir('legacies-data-');
  placeExecutable(path.join(data, 'graphify', 'bin'));
  const res = cli(root, ['graph', 'status'], { pluginData: data });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /graphify: kurulu\b(?! değil)/);
});

test('graph status ignores a graphify the user put on PATH', () => {
  const { root } = project();
  const userBin = placeExecutable(tempDir('user-bin-'));
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const res = cli(root, ['graph', 'status'], { env: { [pathKey]: `${userBin}${path.delimiter}${process.env[pathKey]}` } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /graphify: kurulu değil/);
});

test('graph build shows graphify progress but not its hint about commands legacies never runs', () => {
  const { root, env } = project();
  const res = cli(root, ['graph', 'build'], { env });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /1 nodes/);
  assert.doesNotMatch(res.stdout, /cluster-only/);
});
