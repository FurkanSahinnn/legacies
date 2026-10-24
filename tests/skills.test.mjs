import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'registry.json'), 'utf8'));

function coreFiles() {
  const skills = fs.readdirSync(path.join(ROOT, 'skills')).map((name) => path.join('skills', name, 'SKILL.md'));
  const agents = fs.readdirSync(path.join(ROOT, 'agents')).map((name) => path.join('agents', name));
  const rules = fs.readdirSync(path.join(ROOT, 'rules'), { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => path.join('rules', f));
  return [...skills, ...agents, ...rules].filter((rel) => fs.existsSync(path.join(ROOT, rel)));
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('core skills and agents keep their own files out of the project\'s tracked paths', () => {
  // Where upstream workflows write their reports, specs and task lists; legacies keeps these under .legacies/.
  const upstreamOutputs = ['docs/releases/', '.github/tdd/', '.claude/tdd/', 'tasks/plan.md', 'tasks/todo.md', 'SPEC.md', 'CONSTRAINTS.md', 'docs/superpowers/'];

  const hits = coreFiles().flatMap((rel) => upstreamOutputs.filter((p) => read(rel).includes(p)).map((p) => `${rel}: ${p}`));

  assert.deepEqual(hits, []);
});

test('every attribution in the core names a registered source with its license and copyright', () => {
  const sources = Object.values(registry.sources).filter((s) => !s.verbatim);
  const lines = coreFiles().flatMap((rel) => read(rel).split('\n').filter((l) => l.startsWith('<!-- Adapted from')).map((line) => ({ rel, line })));

  const wrong = lines
    .filter(({ line }) => {
      const m = line.match(/^<!-- Adapted from (\S+) \((\S+), (Copyright \(c\) [^)]+)\): .+ -->\s*$/);
      return !m || !sources.some((s) => s.name === m[1] && s.license === m[2] && s.copyright === m[3]);
    })
    .map(({ rel, line }) => `${rel}: ${line}`);

  assert.ok(lines.length > 0);
  assert.deepEqual(wrong, []);
});
