import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HELPERS = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers.mjs')).href;

// A git repository is the hardest case: git writes its objects read-only.
test('folders made by the test helpers are removed when the test process exits', () => {
  const script = `import { commit, gitRepo, tempDir, write } from ${JSON.stringify(HELPERS)};
const repo = gitRepo();
write(repo, 'more.txt', 'x');
commit(repo, 'more');
process.stdout.write(JSON.stringify([repo, tempDir('legacies-cleanup-')]));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const dirs = JSON.parse(res.stdout);
  assert.equal(dirs.length, 2);
  for (const dir of dirs) assert.equal(fs.existsSync(dir), false, dir);
});
