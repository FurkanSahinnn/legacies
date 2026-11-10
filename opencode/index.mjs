import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { HANDLERS } from '../scripts/lib/hooks.mjs';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultDataDir() {
  if (process.env.LEGACIES_OPENCODE_DATA) return path.resolve(process.env.LEGACIES_OPENCODE_DATA);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'opencode', 'legacies');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode', 'legacies');
}

function coreSkills(pluginRoot) {
  const root = path.join(pluginRoot, 'skills');
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map((entry) => {
      const file = path.join(root, entry.name, 'SKILL.md');
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      return {
        id: entry.name,
        name: data.name || entry.name,
        description: data.description || '',
        path: file,
        content: body.trim(),
        autoinvoke: data['disable-model-invocation'] !== 'true',
      };
    });
}

function additionalContext(result) {
  return result?.hookSpecificOutput?.additionalContext || '';
}

function toolName(name) {
  const names = {
    write: 'Write',
    edit: 'Edit',
    multiedit: 'MultiEdit',
    multi_edit: 'MultiEdit',
    notebookedit: 'NotebookEdit',
    notebook_edit: 'NotebookEdit',
    patch: 'apply_patch',
    apply_patch: 'apply_patch',
    bash: 'Bash',
    shell: 'Bash',
  };
  return names[String(name || '').toLowerCase()] || name;
}

function toolInput(input = {}) {
  return {
    ...input,
    file_path: input.file_path || input.filePath || input.path,
    notebook_path: input.notebook_path || input.notebookPath,
    new_string: input.new_string || input.newString,
    old_string: input.old_string || input.oldString,
    new_source: input.new_source || input.newSource,
  };
}

function guardDecision(result) {
  const output = result?.hookSpecificOutput;
  if (!output?.permissionDecision) return null;
  return { effect: output.permissionDecision, message: output.permissionDecisionReason };
}

function permissionTool(event) {
  const action = String(event.action || '').toLowerCase();
  const resources = Array.isArray(event.resources) ? event.resources : [];
  const metadataInput = event.metadata?.input && typeof event.metadata.input === 'object' ? event.metadata.input : {};
  if (action === 'bash' || action === 'shell' || action === 'powershell') {
    return { name: 'Bash', input: { ...metadataInput, command: metadataInput.command || resources.join(' ') } };
  }
  if (['write', 'edit', 'patch', 'apply_patch'].includes(action)) {
    return { name: 'Write', input: toolInput({ ...metadataInput, filePath: metadataInput.filePath || metadataInput.path || resources[0] }) };
  }
  return null;
}

function disposeAll(registrations) {
  return async () => {
    for (const registration of [...registrations].reverse()) await registration?.dispose?.();
  };
}

export function createOpenCodePlugin({ pluginRoot = DEFAULT_ROOT, dataDir = defaultDataDir(), handlers = HANDLERS } = {}) {
  return {
    id: 'legacies',
    async setup(ctx) {
      const registrations = [];
      const startup = new Map();
      const prompt = new Map();
      const cwd = ctx.location.directory;

      const run = (event, input) => {
        const previous = process.env.LEGACIES_PLUGIN_DATA;
        process.env.LEGACIES_PLUGIN_DATA = dataDir;
        try {
          return handlers[event]?.({ cwd, harness: 'opencode', ...input }) || null;
        } catch {
          return null;
        } finally {
          if (previous === undefined) delete process.env.LEGACIES_PLUGIN_DATA;
          else process.env.LEGACIES_PLUGIN_DATA = previous;
        }
      };

      registrations.push(await ctx.skill.transform((editor) => {
        for (const skill of coreSkills(pluginRoot)) if (!editor.get(skill.id)) editor.add(skill);
      }));

      registrations.push(await ctx.session.hook('prompt', (event) => {
        const result = run('user-prompt-submit', { session_id: event.sessionID, prompt: event.prompt.text });
        prompt.set(event.sessionID, additionalContext(result));
      }));

      registrations.push(await ctx.session.hook('context', (event) => {
        if (!startup.has(event.sessionID)) {
          const result = run('session-start', { session_id: event.sessionID, source: 'startup' });
          startup.set(event.sessionID, additionalContext(result));
        }
        const text = [startup.get(event.sessionID), prompt.get(event.sessionID)].filter(Boolean).join('\n\n');
        if (text) event.system.push({ type: 'text', text });
      }));

      registrations.push(await ctx.permission.hook('evaluate', (event) => {
        const mapped = permissionTool(event);
        if (!mapped) return;
        const verdict = guardDecision(run('pre-tool-use', {
          session_id: event.sessionID,
          tool_name: mapped.name,
          tool_input: mapped.input,
        }));
        if (!verdict) return;
        event.effect = verdict.effect;
        event.message = verdict.message;
      }));

      registrations.push(await ctx.tool.hook('execute.before', async (event) => {
        const verdict = guardDecision(run('pre-tool-use', {
          session_id: event.sessionID,
          tool_name: toolName(event.tool),
          tool_input: toolInput(event.input),
        }));
        if (verdict?.effect === 'deny') throw new Error(verdict.message);
      }));

      registrations.push(await ctx.tool.hook('execute.after', (event) => {
        if (event.status && event.status !== 'completed') return;
        run('post-tool-use', {
          session_id: event.sessionID,
          tool_name: toolName(event.tool),
          tool_input: toolInput(event.input),
        });
      }));

      try {
        registrations.push(await ctx.session.hook('experimental.idle', async (event) => {
          if (event.background?.some((work) => work.sessionID === event.sessionID)) return;
          const reminder = run('stop', { session_id: event.sessionID, stop_hook_active: false });
          if (reminder?.decision !== 'block' || !reminder.reason) return;
          try {
            await ctx.session.synthetic({ sessionID: event.sessionID, text: reminder.reason });
          } catch {
            // A reminder must never make the OpenCode execution fail.
          }
        }));
      } catch {
        // Keep core memory and guards working if this experimental OpenCode hook changes.
      }

      return disposeAll(registrations);
    },
  };
}

export default createOpenCodePlugin();
