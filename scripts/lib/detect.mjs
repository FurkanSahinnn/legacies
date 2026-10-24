// Technology detection for `legacies packs`: lists the project's files once, reads its dependency
// manifests and matches the curated `detect` signals in catalog/registry.json. Nothing is guessed from
// names: a pack or plugin is suggested only when one of its own signals is present.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './project.mjs';

// Dependencies, build output, caches, test fixtures and examples say nothing about the project's own
// stack: a parser's fixtures hold sample files of every language it reads.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.legacies', 'graphify-out', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output',
  '.turbo', '.cache', 'coverage', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.tox', 'Pods', '.gradle', 'obj',
  'DerivedData', '.dart_tool', '.expo', '.terraform',
  'fixtures', '__fixtures__', 'testdata', 'test-data', 'test_data', 'examples', 'samples', '__snapshots__',
]);
const MAX_FILES = 20000;
const MAX_DEPTH = 8;
const MAX_READ_BYTES = 256 * 1024;
const MAX_CONTENT_FILES = 200;
// Below this many files a source-code extension alone (a few helper scripts, the native shell of a
// React Native or Flutter app) only hints at a stack. Project files such as *.csproj count at once.
const STRONG_EXTENSION_COUNT = 10;
const SOURCE_EXTENSIONS = new Set([
  'py', 'ipynb', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'm', 'mm', 'dart', 'rb', 'php',
  'cs', 'fs', 'fsx', 'vb', 'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'cu', 'cuh', 'pl', 'pm', 't', 'ets', 'vue', 'svelte', 'lua',
  'scala', 'ex', 'exs', 'erl', 'hs', 'r', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'liquid', 'graphql',
  'gql', 'cbl', 'cob', 'jcl', 'frm', 'cls',
]);
const ALWAYS_REASON = 'her projede önerilir';
const DEP_LABEL = { npm: 'package.json', pypi: 'Python', jvm: 'Maven/Gradle', nuget: 'NuGet', composer: 'composer.json', gem: 'Gemfile', pub: 'pubspec.yaml', go: 'go.mod', cargo: 'Cargo.toml' };
const NPM_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const JVM_FILES = /^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|libs\.versions\.toml)$/;
const COMPOSE_FILES = /^(docker-)?compose[\w.-]*\.ya?ml$/;
const PY_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

const escapeRegex = (s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
const basename = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const normalizePy = (name) => name.toLowerCase().replace(/[_.]+/g, '-');

// `*` stays inside one path segment, `**` crosses them. A pattern with a slash matches the end of a
// path at a segment boundary, so `prisma/schema.prisma` also finds apps/api/prisma/schema.prisma;
// a leading slash anchors it at the project root, as in .gitignore.
function globTester(pattern) {
  const anchored = pattern.startsWith('/');
  const body = anchored ? pattern.slice(1) : pattern;
  const source = body.toLowerCase().split('**').map((part) => part.split('*').map(escapeRegex).join('[^/]*')).join('.*');
  if (!anchored && !body.includes('/')) {
    const re = new RegExp(`^${source}$`);
    return (rel) => re.test(basename(rel).toLowerCase());
  }
  const re = new RegExp(`${anchored ? '^' : '(^|/)'}${source}$`);
  return (rel) => re.test(rel.toLowerCase());
}

function sourceExtension(pattern) {
  const ext = /^\*\.([\w+-]+)$/.exec(pattern)?.[1];
  return Boolean(ext) && SOURCE_EXTENSIONS.has(ext.toLowerCase());
}

function walk(root) {
  const files = [];
  const visit = (dir, depth) => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return; // An unreadable folder only means fewer signals.
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) visit(rel, depth + 1);
      else if (entry.isFile() && files.length < MAX_FILES) files.push(rel);
    }
  };
  visit('', 0);
  return files;
}

// git's own listing honours .gitignore; .env files are usually ignored but name the services in use,
// so the ones at the root are added back. Their values are never shown, only the signal that matched.
// The index still lists files deleted or moved in the working tree until the change is committed.
function gitFiles(root) {
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeout: 10000 });
  if (listed === null) return null;
  const gone = new Set((git(root, ['ls-files', '-z', '--deleted'], { timeout: 10000 }) || '').split('\0').filter(Boolean));
  return listed.split('\0').filter((f) => f && !gone.has(f));
}

function listProjectFiles(root) {
  const listed = fs.existsSync(path.join(root, '.git')) ? gitFiles(root) : null;
  const files = (listed || walk(root)).filter((f) => !f.split('/').some((part) => SKIP_DIRS.has(part)));
  let envFiles = [];
  try {
    envFiles = fs.readdirSync(root).filter((name) => name.startsWith('.env') && !files.includes(name));
  } catch {
    // No readable root: nothing to add.
  }
  return [...files.slice(0, MAX_FILES), ...envFiles];
}

function readSmall(root, rel) {
  try {
    const file = path.join(root, rel);
    return fs.statSync(file).size > MAX_READ_BYTES ? '' : fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function dirsOf(files) {
  const dirs = new Set();
  for (const rel of files) {
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs];
}

function npmDeps(text) {
  try {
    const json = JSON.parse(text);
    return NPM_FIELDS.flatMap((field) => Object.keys(json[field] || {}));
  } catch {
    return [];
  }
}

const quotedRequirements = (s) => [...s.matchAll(/["']([^"']+)["']/g)].map((m) => PY_NAME.exec(m[1])?.[1]).filter(Boolean);
const closesArray = (s) => s.replace(/(["'])(?:(?!\1).)*\1/g, '').includes(']');
const isPoetryTable = (table) => /^tool\.poetry\.(dev-)?dependencies$|^tool\.poetry\.group\.[\w-]+\.dependencies$/.test(table);
const isRequirementArray = (table, key) => (table === 'project' && key === 'dependencies') || table === 'project.optional-dependencies' || table === 'dependency-groups' || (table === 'tool.uv' && key === 'dev-dependencies');

// Enough TOML for dependency lists: PEP 621 arrays, PEP 735 groups, uv dev-dependencies and Poetry tables.
function pyprojectNames(text) {
  const names = [];
  let table = '';
  let inArray = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (inArray) {
      names.push(...quotedRequirements(line));
      inArray = !closesArray(line);
      continue;
    }
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      table = header[1].trim();
      continue;
    }
    const kv = /^([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (isPoetryTable(table)) {
      if (kv[1] !== 'python') names.push(kv[1]);
    } else if (isRequirementArray(table, kv[1]) && kv[2].startsWith('[')) {
      names.push(...quotedRequirements(kv[2]));
      inArray = !closesArray(kv[2]);
    }
  }
  return names;
}

const requirementNames = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-')).map((l) => PY_NAME.exec(l)?.[1]).filter(Boolean);
const pipfileNames = (text) => tableKeys(text, /^(dev-)?packages$/);
const setupPyNames = (text) => quotedRequirements(/install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] || '');
const setupCfgNames = (text) => requirementNames(/install_requires\s*=\s*\n((?:[ \t]+\S.*\n?)+)/.exec(text)?.[1] || '');
const condaNames = (text) => [...text.matchAll(/^\s*-\s+([A-Za-z0-9][\w.-]*)\s*(?:[=<>!~]|$)/gm)].map((m) => m[1]).filter((n) => n !== 'pip');

// Keys of the TOML tables whose names match `tableName`.
function tableKeys(text, tableName) {
  const keys = [];
  let inTable = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) inTable = tableName.test(header[1].trim());
    else if (inTable) keys.push(...(/^["']?([\w.-]+)["']?\s*=/.exec(line)?.slice(1) || []));
  }
  return keys;
}

function cargoCrates(text) {
  const crates = [];
  let inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const table = header[1].trim();
      const single = /(?:^|\.)(?:dev-|build-)?dependencies\.([\w-]+)$/.exec(table);
      if (single) crates.push(single[1]);
      inDeps = !single && /(?:^|\.)(?:dev-|build-)?dependencies$/.test(table);
    } else if (inDeps) {
      crates.push(...(/^([\w-]+)\s*=/.exec(line)?.slice(1) || []));
    }
  }
  return crates;
}

function goModules(text) {
  const modules = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (/^require\s*\($/.test(line)) inBlock = true;
    else if (inBlock && line === ')') inBlock = false;
    else modules.push(...((inBlock ? /^(\S+)\s+v\S+/ : /^require\s+(\S+)\s+v\S+/).exec(line)?.slice(1) || []));
  }
  return modules;
}

// First-level keys under the top-level `dependencies:` and `dev_dependencies:` blocks.
function pubPackages(text) {
  const names = [];
  let inDeps = false;
  let indent = null;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      inDeps = /^(dev_)?dependencies:\s*(#.*)?$/.test(line);
      indent = null;
      continue;
    }
    const entry = inDeps && /^( +)([A-Za-z0-9_]+):/.exec(line);
    if (!entry) continue;
    indent ??= entry[1].length;
    if (entry[1].length === indent) names.push(entry[2]);
  }
  return names;
}

const composerDeps = (text) => {
  try {
    const json = JSON.parse(text);
    return [...Object.keys(json.require || {}), ...Object.keys(json['require-dev'] || {})];
  } catch {
    return [];
  }
};
const gemNames = (text) => [...text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]);
const nugetNames = (text) => [...text.matchAll(/<Package(?:Reference|Version)\s+(?:Include|Update)="([^"]+)"/g)].map((m) => m[1].toLowerCase());

// Which files feed which ecosystem, by file name (and path for requirements/ folders).
const MANIFESTS = [
  ['npm', (b) => b === 'package.json', npmDeps],
  ['pypi', (b, rel) => /^requirements.*\.txt$/.test(b) || /(^|\/)requirements\/[^/]+\.txt$/.test(rel), requirementNames],
  ['pypi', (b) => b === 'pyproject.toml', pyprojectNames],
  ['pypi', (b) => b === 'Pipfile', pipfileNames],
  ['pypi', (b) => b === 'setup.py', setupPyNames],
  ['pypi', (b) => b === 'setup.cfg', setupCfgNames],
  ['pypi', (b) => /^environment\.ya?ml$/.test(b), condaNames],
  ['nuget', (b) => /\.(cs|fs|vb)proj$/.test(b) || b === 'Directory.Packages.props', nugetNames],
  ['composer', (b) => b === 'composer.json', composerDeps],
  ['gem', (b) => b === 'Gemfile', gemNames],
  ['pub', (b) => b === 'pubspec.yaml', pubPackages],
  ['go', (b) => b === 'go.mod', goModules],
  ['cargo', (b) => b === 'Cargo.toml', cargoCrates],
];

function readDependencies(files, read) {
  const deps = Object.fromEntries(Object.keys(DEP_LABEL).filter((eco) => eco !== 'jvm').map((eco) => [eco, new Set()]));
  for (const rel of files) {
    const name = basename(rel);
    for (const [eco, accepts, parse] of MANIFESTS) {
      if (!accepts(name, rel)) continue;
      for (const dep of parse(read(rel))) deps[eco].add(eco === 'pypi' ? normalizePy(dep) : dep);
    }
  }
  return deps;
}

function composeImages(files, read) {
  const images = new Set();
  for (const rel of files.filter((f) => COMPOSE_FILES.test(basename(f)))) {
    for (const m of read(rel).matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gm)) images.add(m[1].replace(/:[^/]*$/, '').toLowerCase());
  }
  return images;
}

export function scanProject(root) {
  const files = listProjectFiles(root);
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) cache.set(rel, readSmall(root, rel));
    return cache.get(rel);
  };
  let remotes = null;
  return {
    root,
    files,
    dirs: dirsOf(files),
    read,
    deps: readDependencies(files, read),
    jvmText: files.filter((f) => JVM_FILES.test(basename(f))).map(read).join('\n').toLowerCase(),
    compose: composeImages(files, read),
    gitRemotes: () => (remotes ??= (git(root, ['remote', '-v']) || '').toLowerCase()),
  };
}

function matchDependency(eco, name, facts) {
  if (eco === 'jvm') return facts.jvmText.includes(name.toLowerCase()) ? name : null;
  const installed = [...facts.deps[eco]];
  const wanted = eco === 'pypi' ? normalizePy(name) : eco === 'nuget' ? name.toLowerCase() : name;
  if (wanted.endsWith('/*')) return installed.find((dep) => dep.startsWith(wanted.slice(0, -1))) || null;
  if (eco === 'go') return installed.find((dep) => dep === wanted || dep.startsWith(`${wanted}/`)) || null;
  return facts.deps[eco].has(wanted) ? wanted : null;
}

function findContaining({ files, text }, facts) {
  const test = globTester(files);
  const needle = text.toLowerCase();
  return facts.files.filter(test).slice(0, MAX_CONTENT_FILES).find((rel) => facts.read(rel).toLowerCase().includes(needle)) || null;
}

// A match on manifests, marker files, images or file contents is strong; a match that rests only on
// a few files of one extension is weak, so it is offered but not pre-checked.
export function matchDetect(detect = {}, facts) {
  const reasons = [];
  let strong = false;
  const hit = (reason, isStrong = true) => {
    reasons.push(reason);
    strong ||= isStrong;
  };
  for (const pattern of detect.files || []) {
    const hits = facts.files.filter(globTester(pattern));
    if (!hits.length) continue;
    if (sourceExtension(pattern)) hit(`${pattern} (${hits.length} dosya)`, hits.length >= STRONG_EXTENSION_COUNT);
    else hit(hits[0]);
  }
  for (const dir of detect.dirs || []) {
    const found = facts.dirs.find(globTester(dir));
    if (found) hit(`${found}/`);
  }
  for (const [eco, label] of Object.entries(DEP_LABEL)) {
    for (const name of detect[eco] || []) {
      const found = matchDependency(eco, name, facts);
      if (found) hit(`${label}: ${found}`);
    }
  }
  for (const prefix of detect.compose || []) {
    const image = [...facts.compose].find((i) => i.startsWith(prefix.toLowerCase()));
    if (image) hit(`docker-compose: ${image}`);
  }
  for (const signal of detect.contains || []) {
    const file = findContaining(signal, facts);
    if (file) hit(`${file}: ${signal.text}`);
  }
  for (const part of detect.gitRemote || []) if (facts.gitRemotes().includes(part.toLowerCase())) hit(`git remote: ${part}`);
  return { reasons, weak: reasons.length > 0 && !strong };
}

// Packs that live in the core plugin are always installed, so they are never offered.
export function detectCatalog(registry, facts) {
  const packs = [];
  for (const pack of registry.packs.filter((p) => p.members.length)) {
    const { reasons, weak } = matchDetect(pack.detect, facts);
    if (reasons.length) packs.push({ id: pack.id, reasons, weak });
    else if (pack.recommend === 'always') packs.push({ id: pack.id, reasons: [ALWAYS_REASON], weak: false });
  }
  const official = [];
  for (const plugin of registry.official || []) {
    const { reasons, weak } = matchDetect(plugin.detect, facts);
    if (reasons.length) official.push({ name: plugin.name, reasons, weak });
  }
  return { packs, official };
}
