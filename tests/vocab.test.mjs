import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, commit, gitRepo, initMemory, write } from './helpers.mjs';

// Code that says "chest" in two names and folders and "message" in one name; "balance" is only inside a body.
function chestProject({ graph = true } = {}) {
  const root = gitRepo();
  write(root, 'src/chest/open.ts', 'export function openChest(id: string) {\n  const balance = 0;\n  return balance;\n}\n');
  write(root, 'src/chest/reward.ts', 'export function chestReward(id: string) {\n  return id;\n}\n');
  write(root, 'src/inbox/send.ts', 'export function sendMessage(text: string) {\n  return text;\n}\n');
  commit(root, 'code');
  initMemory(root);
  if (graph) {
    const node = (id, label, file) => ({ id, label, file_type: 'code', source_file: file, source_location: 'L1' });
    const nodes = [node('a', 'openChest()', 'src/chest/open.ts'), node('b', 'chestReward()', 'src/chest/reward.ts'), node('c', 'sendMessage()', 'src/inbox/send.ts')];
    write(root, '.legacies/graph/graph.json', JSON.stringify({ nodes, links: [] }));
  }
  return root;
}

function vocab(root, args = []) {
  const res = cli(root, ['vocab', ...args]);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

test("vocab lists the words of the project's names and folders, the most used first", () => {
  const words = vocab(chestProject()).split(/\s+/);
  assert.ok(words.includes('chest') && words.includes('message'), words.join(' '));
  assert.ok(words.indexOf('chest') < words.indexOf('message'), words.join(' '));
});

test('vocab without a code graph takes the words inside the files', () => {
  const words = vocab(chestProject({ graph: false })).split(/\s+/);
  assert.ok(words.includes('balance'), words.join(' '));
});

test('vocab leaves out keywords and folder names every project has', () => {
  const words = vocab(chestProject({ graph: false })).split(/\s+/);
  for (const generic of ['export', 'function', 'src']) assert.ok(!words.includes(generic), `${generic}: ${words.join(' ')}`);
});

test('vocab given candidate words shows which of them the project uses', () => {
  const text = vocab(chestProject(), ['chest', 'crate']);
  assert.match(text, /^chest: chest \(\d+\)/m);
  assert.match(text, /^crate: yok/m);
});
