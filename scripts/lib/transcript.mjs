import fs from 'node:fs';
import { oneLine } from './util.mjs';

const TAIL_BYTES = 8 * 1024 * 1024;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Reads only the end of the transcript; long sessions can reach 100+ MB.
export function readTranscriptTail(file, maxBytes = TAIL_BYTES) {
  if (!file) return [];
  let fd;
  try {
    const { size } = fs.statSync(file);
    const start = Math.max(0, size - maxBytes);
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    const entries = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip a line torn by a concurrent write.
      }
    }
    return entries;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Queued or injected text that did not come from the person typing.
function isHumanText(text) {
  if (typeof text !== 'string') return false;
  const t = text.trimStart();
  return t.length > 0 && !t.startsWith('<') && !t.startsWith('[SYSTEM') && !t.startsWith('Another Claude session');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function resultText(block) {
  return typeof block.content === 'string' ? block.content : textOf(block.content);
}

export function summarizeTranscript(entries, { maxPrompts = 6 } = {}) {
  const prompts = [];
  const seen = new Set();
  const files = new Set();
  const askIds = new Set();
  let todos = null;
  let lastAssistant = '';
  let title = '';

  const addPrompt = (text, at) => {
    const key = oneLine(text, 400);
    if (!key || seen.has(key)) return;
    seen.add(key);
    prompts.push({ text: key, at });
  };

  for (const e of entries) {
    if (e.type === 'ai-title' && e.aiTitle) title = e.aiTitle;
    if (e.type === 'queue-operation' && e.operation === 'enqueue' && isHumanText(e.content)) {
      addPrompt(e.content, e.timestamp);
    }
    if (e.type === 'user') {
      const content = e.message && e.message.content;
      if (e.origin && e.origin.kind === 'human' && !e.isMeta) {
        const text = textOf(content);
        if (isHumanText(text)) addPrompt(text, e.timestamp);
      }
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'tool_result' && askIds.has(b.tool_use_id)) addPrompt(`[Soru cevabı] ${resultText(b)}`, e.timestamp);
        }
      }
    }
    if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      for (const b of e.message.content) {
        if (!b) continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) lastAssistant = b.text;
        if (b.type !== 'tool_use') continue;
        const input = b.input || {};
        if (EDIT_TOOLS.has(b.name) && (input.file_path || input.notebook_path)) files.add(input.file_path || input.notebook_path);
        if (b.name === 'AskUserQuestion') askIds.add(b.id);
        if (Array.isArray(input.todos)) todos = input.todos;
      }
    }
  }
  return { title, prompts: prompts.slice(-maxPrompts), files: [...files], todos, lastAssistant };
}
