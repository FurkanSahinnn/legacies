import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasProjectOpenCode,
  installProjectOpenCode,
  openCodeLoaderFile,
  uninstallProjectOpenCode,
} from '../scripts/lib/opencode.mjs';
import { createOpenCodePlugin } from '../opencode/index.mjs';
import { cli, commit, gitRepo, initMemory, run, write } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'opencode', 'index.mjs');

test('OpenCode install writes one machine-local loader and keeps git clean', () => {
  const root = gitRepo();
  const installed = installProjectOpenCode(ENTRY, root);

  assert.equal(installed.file, openCodeLoaderFile(root));
  assert.match(fs.readFileSync(installed.file, 'utf8'), /^\/\/ Managed by legacies;[\s\S]*export \{ default \} from "file:\/\//);
  assert.match(fs.readFileSync(installed.file, 'utf8'), /opencode\/index\.mjs";\n$/);
  assert.equal(hasProjectOpenCode(root), true);
  assert.equal(run(root, 'git', ['status', '--porcelain']), '');
});

test('OpenCode uninstall removes only the legacies loader', () => {
  const root = gitRepo();
  write(root, '.opencode/plugins/mine.js', 'export default {}\n');
  installProjectOpenCode(ENTRY, root);

  assert.equal(uninstallProjectOpenCode(root), true);
  assert.equal(fs.existsSync(openCodeLoaderFile(root)), false);
  assert.equal(fs.readFileSync(path.join(root, '.opencode', 'plugins', 'mine.js'), 'utf8'), 'export default {}\n');
});

test('OpenCode install refuses a loader tracked by the repository', () => {
  const root = gitRepo();
  write(root, '.opencode/plugins/legacies.js', 'export default {}\n');
  commit(root, 'team OpenCode plugin');

  assert.throws(() => installProjectOpenCode(ENTRY, root), /git'te takip ediliyor/);
  assert.equal(fs.readFileSync(openCodeLoaderFile(root), 'utf8'), 'export default {}\n');
});

test('OpenCode install does not claim a lookalike loader owned by someone else', () => {
  const root = gitRepo();
  const other = 'export { default } from "file:///somewhere/else/opencode/index.mjs";\n';
  write(root, '.opencode/plugins/legacies.js', other);

  assert.throws(() => installProjectOpenCode(ENTRY, root), /başka bir eklenti/);
  assert.equal(uninstallProjectOpenCode(root), false);
  assert.equal(fs.readFileSync(openCodeLoaderFile(root), 'utf8'), other);
});

test('opencode CLI installs, reports and removes the project adapter', () => {
  const root = gitRepo();
  const install = cli(root, ['opencode', 'install']);
  assert.equal(install.status, 0, install.stderr);
  assert.equal(hasProjectOpenCode(root), true);
  assert.match(cli(root, ['opencode', 'status']).stdout, /OpenCode plugin'i .*: var/);

  const uninstall = cli(root, ['opencode', 'uninstall']);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(hasProjectOpenCode(root), false);
  assert.match(uninstall.stdout, /kaldırıldı/);
});

test('doctor reports the project OpenCode adapter', () => {
  const root = gitRepo();
  installProjectOpenCode(ENTRY, root);

  assert.match(cli(root, ['doctor']).stdout, /OpenCode adaptörü: var/);
});

function fakeContext(root) {
  const registered = { skills: [], session: {}, tool: {}, permission: {}, synthetic: [] };
  return {
    registered,
    ctx: {
      location: { directory: root, project: { id: 'project-1', directory: root, canonical: root } },
      skill: {
        async transform(callback) {
          callback({
            list: () => registered.skills,
            get: (id) => registered.skills.find((skill) => skill.id === id),
            add: (skill) => registered.skills.push(skill),
            update() {},
            remove() {},
          });
          return { async dispose() {} };
        },
      },
      session: {
        async hook(name, callback) {
          registered.session[name] = callback;
          return { async dispose() {} };
        },
        async synthetic(input) {
          registered.synthetic.push(input);
        },
      },
      tool: {
        async hook(name, callback) {
          registered.tool[name] = callback;
          return { async dispose() {} };
        },
      },
      permission: {
        async hook(name, callback) {
          registered.permission[name] = callback;
          return { async dispose() {} };
        },
      },
    },
  };
}

test('OpenCode plugin registers core skills and injects project memory without changing the prompt', async () => {
  const root = gitRepo();
  initMemory(root);
  cli(root, ['add', '--type', 'decision', '--title', 'Webhook imzası zorunlu', '--text', 'Ham gövde HMAC ile doğrulanır.']);
  const { ctx, registered } = fakeContext(root);

  await createOpenCodePlugin({ pluginRoot: ROOT, dataDir: path.join(root, '.test-runtime') }).setup(ctx);

  assert.equal(registered.skills.length, 14);
  assert.ok(registered.skills.some((skill) => skill.id === 'recall' && /Search/.test(skill.description)));
  const prompt = { sessionID: 'open-1', prompt: { text: 'Webhook imzasını nerede doğruluyoruz?' }, delivery: 'steer' };
  await registered.session.prompt(prompt);
  assert.equal(prompt.prompt.text, 'Webhook imzasını nerede doğruluyoruz?');

  const request = { sessionID: 'open-1', agent: 'build', system: [], messages: [], tools: {}, options: {} };
  await registered.session.context(request);
  assert.match(request.system.map((part) => part.text).join('\n'), /Webhook imzası zorunlu/);
});

test('OpenCode tool completion records edits through the shared hook core', async () => {
  const root = gitRepo();
  initMemory(root);
  const { ctx, registered } = fakeContext(root);
  await createOpenCodePlugin({ pluginRoot: ROOT, dataDir: path.join(root, '.test-runtime') }).setup(ctx);

  await registered.tool['execute.after']({
    sessionID: 'open-edit',
    tool: 'write',
    input: { filePath: path.join(root, 'src', 'new.ts'), content: 'export const x = 1\n' },
    status: 'completed',
    result: {},
  });

  const ledger = fs.readFileSync(path.join(root, '.legacies', 'state', 'sessions', 'open-edit.jsonl'), 'utf8');
  assert.match(ledger, /src\/new\.ts/);
});

test('OpenCode permission hook applies the shared shell and config guards', async () => {
  const root = gitRepo();
  write(root, 'eslint.config.js', 'export default []\n');
  const { ctx, registered } = fakeContext(root);
  await createOpenCodePlugin({ pluginRoot: ROOT, dataDir: path.join(root, '.test-runtime') }).setup(ctx);

  const shell = { sessionID: 'open-guard', action: 'bash', resources: ['git commit --no-verify'], effect: 'allow' };
  await registered.permission.evaluate(shell);
  assert.equal(shell.effect, 'deny');
  assert.match(shell.message, /--no-verify engellendi/);

  const config = { sessionID: 'open-guard', action: 'write', resources: [path.join(root, 'eslint.config.js')], effect: 'allow' };
  await registered.permission.evaluate(config);
  assert.equal(config.effect, 'ask');
  assert.match(config.message, /lint\/format\/tip/);
});

test('OpenCode blocks a secret-bearing write before the tool executes', async () => {
  const root = gitRepo();
  const { ctx, registered } = fakeContext(root);
  await createOpenCodePlugin({ pluginRoot: ROOT, dataDir: path.join(root, '.test-runtime') }).setup(ctx);

  await assert.rejects(
    registered.tool['execute.before']({
      sessionID: 'open-secret',
      tool: 'write',
      input: { filePath: path.join(root, 'src', 'key.ts'), content: `export const key = '${'sk-proj-' + 'a'.repeat(40)}'\n` },
    }),
    /OpenAI API anahtarı/,
  );
});

test('OpenCode idle hook requests one handoff after an edit window', async () => {
  const root = gitRepo();
  initMemory(root);
  const { ctx, registered } = fakeContext(root);
  await createOpenCodePlugin({ pluginRoot: ROOT, dataDir: path.join(root, '.test-runtime') }).setup(ctx);

  for (const file of ['one.ts', 'two.ts', 'three.ts']) {
    await registered.tool['execute.after']({
      sessionID: 'open-idle',
      tool: 'write',
      input: { filePath: path.join(root, 'src', file), content: '' },
      status: 'completed',
      result: {},
    });
  }
  const idle = { sessionID: 'open-idle', background: [] };
  await registered.session['experimental.idle'](idle);
  await registered.session['experimental.idle'](idle);

  assert.equal(registered.synthetic.length, 1);
  assert.match(registered.synthetic[0].text, /devir kartı/);
});
