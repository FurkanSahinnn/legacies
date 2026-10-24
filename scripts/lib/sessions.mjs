import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';
import { dateStamp, ensureDir, localStamp, mtimeMs, readText, writeAtomic } from './util.mjs';

export function shortId(sessionId) {
  return String(sessionId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'nosession';
}

export function listCards(paths) {
  let entries;
  try {
    entries = fs.readdirSync(paths.sessions, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(paths.sessions, e.name))
    .map((file) => ({ file, mtime: mtimeMs(file) }))
    .sort((a, b) => b.mtime - a.mtime);
}

export function findCard(paths, sessionId) {
  const suffix = `-${shortId(sessionId)}.md`;
  return listCards(paths).find((c) => c.file.endsWith(suffix))?.file || null;
}

export function readCard(file) {
  const { data, body } = parseFrontmatter(readText(file, ''));
  return { file, data, body, auto: data.auto === 'true', mtime: mtimeMs(file) };
}

// One card per session, rewritten in place; the file name keeps the session's first write time.
export function writeCard(paths, sessionId, content, { auto = false } = {}) {
  const now = new Date();
  const hhmm = localStamp(now).slice(11).replace(':', '');
  const file =
    findCard(paths, sessionId) || path.join(paths.sessions, `${dateStamp(now)}-${hhmm}-${shortId(sessionId)}.md`);
  const data = { session: shortId(sessionId), updated: localStamp(now), auto: auto ? 'true' : 'false' };
  const body = `# Devir kartı · ${localStamp(now)} · ${shortId(sessionId)}\n\n${String(content).trim()}\n`;
  writeAtomic(file, stringifyFrontmatter(data, body));
  return file;
}

export function latestCards(paths, { exclude = null, limit = 5 } = {}) {
  const skip = exclude ? `-${shortId(exclude)}.md` : null;
  return listCards(paths)
    .filter((c) => !skip || !c.file.endsWith(skip))
    .slice(0, limit)
    .map((c) => readCard(c.file));
}

// Moves cards beyond the newest `keep` into sessions/archive/ unchanged.
export function archiveOldCards(paths, keep) {
  const cards = listCards(paths);
  if (cards.length <= keep) return 0;
  ensureDir(paths.archive);
  let moved = 0;
  for (const card of cards.slice(keep)) {
    try {
      fs.renameSync(card.file, path.join(paths.archive, path.basename(card.file)));
      moved += 1;
    } catch {
      // A card another process is writing stays until the next run.
    }
  }
  return moved;
}
