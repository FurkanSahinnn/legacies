import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkFileWrite, checkShellCommand, findSecret } from '../scripts/lib/guards.mjs';
import { gitRepo, hook, tempDir, write } from './helpers.mjs';

// Fake secrets are assembled at runtime so this file never contains a complete token.
const fake = {
  aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
  github: 'ghp_' + 'a'.repeat(36),
  anthropic: 'sk-ant-' + 'b'.repeat(40),
  privateKey: '-----BEGIN ' + 'PRIVATE KEY-----',
  jwt: (role) => {
    const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'supabase', role, exp: 9999999999 })}.${'c'.repeat(30)}`;
  },
};

test('shell guard blocks hook bypasses and allows look-alikes', () => {
  for (const cmd of [
    'git commit --no-verify -m "x"',
    'git commit -nm "x"',
    'git -C repo push --no-verify',
    'git commit --no-veri -m x',
    'npm run lint && git commit -n -m x',
    'HUSKY=0 git commit -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath .nohooks',
  ]) {
    assert.ok(checkShellCommand(cmd), `should block: ${cmd}`);
  }
  for (const cmd of [
    'git commit -m "docs: explain --no-verify"',
    'git commit -mn',
    'git push -n origin main',
    'git status',
    'npm test',
    'echo no-verify',
  ]) {
    assert.equal(checkShellCommand(cmd), null, `should allow: ${cmd}`);
  }
});

test('secret scan finds real kinds of secrets and ignores local or public values', () => {
  assert.match(findSecret(`const k = "${fake.aws}"`), /AWS/);
  assert.match(findSecret(`token=${fake.github}`), /GitHub/);
  assert.match(findSecret(fake.anthropic), /Anthropic/);
  assert.match(findSecret(`${fake.privateKey}\nMIIE...`), /Özel anahtar/);
  assert.match(findSecret(`SERVICE_KEY=${fake.jwt('service_role')}`), /service_role/);
  assert.equal(findSecret(`anon=${fake.jwt('anon')}`), null, 'the anon key is public by design');
  assert.match(findSecret('postgres://admin:S3cr3tPass@db.example.com:5432/app'), /DSN/);
  assert.equal(findSecret('postgres://postgres:postgres@localhost:54322/postgres'), null);
  assert.equal(findSecret('postgresql://user:${DB_PASS}@prod.example.com/app'), null);
});

test('file guard denies secrets in code, allows .env files and asks before loosening lint config', () => {
  const root = tempDir();
  write(root, '.eslintrc.json', '{}');
  assert.equal(checkFileWrite('Write', { file_path: path.join(root, 'src/db.ts'), content: `export const k = "${fake.aws}";` }, root).decision, 'deny');
  assert.equal(checkFileWrite('Write', { file_path: path.join(root, '.env.local'), content: `KEY=${fake.aws}` }, root), null);
  assert.equal(checkFileWrite('Edit', { file_path: path.join(root, '.eslintrc.json'), old_string: '{}', new_string: '{"rules":{}}' }, root).decision, 'ask');
  assert.equal(checkFileWrite('Write', { file_path: path.join(root, 'eslint.config.js'), content: 'export default []' }, root), null, 'a new config file is fine');
  assert.equal(
    checkFileWrite('MultiEdit', { file_path: path.join(root, 'a.ts'), edits: [{ old_string: 'a', new_string: `x = "${fake.github}"` }] }, root).decision,
    'deny',
  );
});

test('pre-tool-use hook emits a permission decision in any project and can be turned off', () => {
  const plain = gitRepo();
  const res = hook(plain, 'pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m x' } });
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(res.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /\[legacies\]/);
  assert.equal(hook(plain, 'pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'git status' } }).json, null);
  const off = hook(plain, 'pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify' } }, { env: { LEGACIES_GUARDS: 'off' } });
  assert.equal(off.json, null);
});
