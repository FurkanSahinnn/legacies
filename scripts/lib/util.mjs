import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

export function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

export function readText(file, fallback = null) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function readJson(file, fallback = null) {
  const text = readText(file);
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Temp file + rename, so a reader never sees a half-written file.
export function writeAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    // Windows refuses to rename over a file another process holds open.
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
    fs.writeFileSync(file, content, 'utf8');
  }
}

export function appendLine(file, line) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
}

export function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

const pad = (n) => String(n).padStart(2, '0');

export function dateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localStamp(date = new Date()) {
  return `${dateStamp(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const TR_ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };

export function foldTurkish(text) {
  return String(text)
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => TR_ASCII[ch])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

export function slugify(text, max = 60) {
  const slug = foldTurkish(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '') || 'not';
}

// Cuts at a line boundary when one is close, then appends the marker line.
export function clip(text, max, marker = '…') {
  if (text.length <= max) return text;
  const room = Math.max(0, max - marker.length - 1);
  let cut = text.slice(0, room);
  const nl = cut.lastIndexOf('\n');
  if (nl > room * 0.6) cut = cut.slice(0, nl);
  return `${cut.trimEnd()}\n${marker}`;
}

export function oneLine(text, max = 160) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}
