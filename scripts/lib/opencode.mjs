import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { excludePattern, git, isGitRepo, removeExcludePattern } from './project.mjs';
import { exists, readText, writeAtomic } from './util.mjs';

export const PROJECT_OPENCODE_LOADER = '.opencode/plugins/legacies.js';
const OPENCODE_EXCLUDE = `/${PROJECT_OPENCODE_LOADER}`;
const LOADER_MARKER = '// Managed by legacies; machine-local OpenCode adapter.';

export const openCodeLoaderFile = (root) => path.join(root, '.opencode', 'plugins', 'legacies.js');

const loaderContent = (entryFile) => `${LOADER_MARKER}\nexport { default } from ${JSON.stringify(pathToFileURL(path.resolve(entryFile)).href)};\n`;

function isOurLoader(text) {
  return /^\/\/ Managed by legacies; machine-local OpenCode adapter\.\r?\nexport \{ default \} from "file:\/\/.*\/opencode\/index\.mjs";\r?\n?$/.test(String(text || '').replace(/\\/g, '/'));
}

export const openCodeFileTracked = (root) => isGitRepo(root) && git(root, ['ls-files', '--error-unmatch', PROJECT_OPENCODE_LOADER]) !== null;

export const hasProjectOpenCode = (root) => isOurLoader(readText(openCodeLoaderFile(root), ''));

export function installProjectOpenCode(entryFile, root) {
  if (openCodeFileTracked(root)) throw new Error(`${PROJECT_OPENCODE_LOADER} git'te takip ediliyor; legacies takip edilen dosyalara yazmaz.`);
  const file = openCodeLoaderFile(root);
  const current = readText(file, '');
  if (current && !isOurLoader(current)) throw new Error(`${PROJECT_OPENCODE_LOADER} başka bir eklenti tarafından kullanılıyor; dokunmadan duruyorum.`);
  writeAtomic(file, loaderContent(entryFile));
  return { file, git: isGitRepo(root) ? excludePattern(root, OPENCODE_EXCLUDE, PROJECT_OPENCODE_LOADER) : null };
}

export function uninstallProjectOpenCode(root) {
  const file = openCodeLoaderFile(root);
  if (!hasProjectOpenCode(root)) return false;
  fs.rmSync(file, { force: true });
  const plugins = path.dirname(file);
  const opencode = path.dirname(plugins);
  if (exists(plugins) && fs.readdirSync(plugins).length === 0) fs.rmdirSync(plugins);
  if (exists(opencode) && fs.readdirSync(opencode).length === 0) fs.rmdirSync(opencode);
  if (isGitRepo(root)) removeExcludePattern(root, OPENCODE_EXCLUDE);
  return true;
}
