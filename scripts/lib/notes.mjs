import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, toList } from './frontmatter.mjs';
import { changedSince } from './project.mjs';
import { oneLine, readText, toPosix, writeAtomic } from './util.mjs';

export const NOTE_TYPES = ['decision', 'gotcha', 'convention', 'howto', 'reference'];

const TYPE_LABELS = {
  decision: 'Kararlar',
  gotcha: 'Tuzaklar',
  convention: 'Kurallar',
  howto: 'Nasıl yapılır',
  reference: 'Referans',
};

export function listMarkdown(dir) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'archive' && !entry.name.startsWith('.')) walk(full);
      } else if (entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

function firstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function firstSentence(body) {
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (text && !text.startsWith('#') && !text.startsWith('>')) return oneLine(text, 140);
  }
  return '';
}

export function readNote(paths, file) {
  const { data, body } = parseFrontmatter(readText(file, ''));
  return {
    file,
    rel: toPosix(path.relative(paths.base, file)),
    data,
    body,
    title: data.title || firstHeading(body) || path.basename(file, '.md'),
    type: data.type || path.basename(path.dirname(file)),
    paths: toList(data.paths),
    tags: toList(data.tags),
    verified: data.verified || '',
    status: data.status || 'active',
    summary: data.summary || firstSentence(body),
  };
}

export function loadNotes(paths) {
  return listMarkdown(paths.memory)
    .filter((file) => path.basename(file) !== 'INDEX.md')
    .map((file) => readNote(paths, file));
}

export function verifiedSha(value) {
  const m = /@([0-9a-f]{6,40})\b/.exec(String(value || ''));
  return m ? m[1] : null;
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// A pattern without wildcards matches the path itself and everything below it.
export function pathMatches(pattern, file) {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const f = file.replace(/\\/g, '/');
  if (!p) return false;
  if (!/[*?]/.test(p)) return f === p || f.startsWith(`${p}/`);
  return globToRegExp(p).test(f);
}

// Maps note.rel -> files under the note's paths that changed since the commit it was verified at.
export function findStale(root, notes, { maxCommits = 8 } = {}) {
  const groups = new Map();
  for (const note of notes) {
    const sha = verifiedSha(note.verified);
    if (!sha || note.status !== 'active' || note.paths.length === 0) continue;
    if (!groups.has(sha)) groups.set(sha, []);
    groups.get(sha).push(note);
  }
  const stale = new Map();
  for (const [sha, group] of [...groups].slice(0, maxCommits)) {
    const changed = changedSince(root, sha);
    if (!changed) continue;
    for (const note of group) {
      const files = changed.filter((f) => note.paths.some((p) => pathMatches(p, f)));
      if (files.length) stale.set(note.rel, files);
    }
  }
  return stale;
}

export function indexLine(note, staleFiles, linkBase = '') {
  const summary = note.summary ? ` — ${note.summary}` : '';
  const where = note.paths.length ? ` · ${note.paths.slice(0, 3).join(', ')}` : '';
  const flag = staleFiles ? ` ⚠ doğrulanmalı (${staleFiles.length} dosya değişti)` : '';
  return `- [${note.title}](${linkBase}${note.rel})${summary}${where}${flag}`;
}

export function groupByType(notes) {
  const active = notes.filter((n) => n.status === 'active');
  const extra = [...new Set(active.map((n) => n.type))].filter((t) => !NOTE_TYPES.includes(t));
  return [...NOTE_TYPES, ...extra]
    .map((type) => ({ type, label: TYPE_LABELS[type] || type, notes: active.filter((n) => n.type === type) }))
    .filter((g) => g.notes.length > 0);
}

export function renderIndex(notes, stale = new Map()) {
  const lines = ['# Hafıza dizini', '', '> `legacies index` üretir; elle düzenleme.', ''];
  const groups = groupByType(notes);
  if (groups.length === 0) lines.push('_Henüz not yok._', '');
  for (const group of groups) {
    lines.push(`## ${group.label}`);
    for (const note of group.notes) lines.push(indexLine(note, stale.get(note.rel), '../'));
    lines.push('');
  }
  return lines.join('\n');
}

export function writeIndex(paths, notes = loadNotes(paths), stale = new Map()) {
  writeAtomic(paths.index, renderIndex(notes, stale));
  return notes.length;
}
