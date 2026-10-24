import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, gitRepo, hook, initMemory } from './helpers.mjs';

const context = (res) => res.json && res.json.hookSpecificOutput && res.json.hookSpecificOutput.additionalContext;

function projectWithNote() {
  const root = gitRepo();
  initMemory(root);
  cli(root, ['add', '--type', 'decision', '--title', 'Shopier webhook imzası zorunlu', '--paths', 'src/pay/**', '--text', 'Neden: sahte ödeme.']);
  return root;
}

test("subagent-start gives a subagent a short brief of the project's memory", () => {
  const res = hook(projectWithNote(), 'subagent-start', { agent_id: 'agent-1', agent_type: 'Explore' });
  assert.equal(res.status, 0);
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SubagentStart');
  const text = context(res);
  assert.match(text, /\[legacies\]/);
  assert.match(text, /Shopier webhook imzası zorunlu/);
  assert.ok(text.length <= 4000, `length ${text.length}`);
});

test('subagent-start stays silent in a project without memory', () => {
  assert.equal(hook(gitRepo(), 'subagent-start', { agent_id: 'agent-1', agent_type: 'Explore' }).json, null);
});

test("subagent-start leaves out Claude Code's own helper agents, which do not work on the project", () => {
  assert.equal(hook(projectWithNote(), 'subagent-start', { agent_id: 'agent-1', agent_type: 'claude-code-guide' }).json, null);
});

test('subagent-start can be turned off', () => {
  const res = hook(projectWithNote(), 'subagent-start', { agent_id: 'agent-1', agent_type: 'Explore' }, { env: { LEGACIES_SUBAGENT_CONTEXT: 'off' } });
  assert.equal(res.json, null);
});
