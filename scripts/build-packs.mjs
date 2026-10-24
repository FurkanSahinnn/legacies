#!/usr/bin/env node
// Maintainer tool: rebuilds packs/ from catalog/registry.json, legacies' own adapted content in catalog/own
// and a local ECC checkout, then lists every pack in .claude-plugin/marketplace.json.
// Usage: node scripts/build-packs.mjs [--ecc <path-to-ECC-checkout>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPacks, withPackEntries } from './lib/catalog.mjs';
import { readJson } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'catalog');
const MARKETPLACE = path.join(ROOT, '.claude-plugin', 'marketplace.json');

function fail(message) {
  process.stderr.write(`build-packs: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const eccArg = args.indexOf('--ecc');
const eccRoot = path.resolve(eccArg >= 0 ? args[eccArg + 1] || '' : path.join(ROOT, '..', 'ECC'));
const registry = readJson(path.join(CATALOG, 'registry.json'));
if (!registry) fail('catalog/registry.json is missing or invalid');
const marketplace = readJson(MARKETPLACE);
if (!marketplace) fail('.claude-plugin/marketplace.json is missing or invalid');
if (!fs.existsSync(path.join(eccRoot, 'skills'))) fail(`no ECC checkout at ${eccRoot}; pass --ecc <path>`);

const head = spawnSync('git', ['-C', eccRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout?.trim();
const pinned = registry.sources.ecc.commit;
if (pinned && head && head !== pinned) process.stderr.write(`build-packs: warning: ECC checkout is at ${head.slice(0, 8)}, registry was reviewed at ${pinned.slice(0, 8)}\n`);

// A source with a `root` lives in this repository; ECC is an outside checkout.
const sourceRoots = { ecc: eccRoot };
for (const [id, source] of Object.entries(registry.sources)) if (source.root) sourceRoots[id] = path.join(ROOT, source.root);

const report = buildPacks({
  registry,
  sourceRoots,
  coreRoot: ROOT,
  evalsRoot: path.join(CATALOG, 'pack-evals'),
  overridesRoot: path.join(CATALOG, 'overrides'),
  outDir: path.join(ROOT, 'packs'),
  version: readJson(path.join(ROOT, 'package.json')).version,
  author: readJson(path.join(ROOT, '.claude-plugin', 'plugin.json')).author.name,
  apacheLicenseFile: path.join(CATALOG, 'licenses', 'Apache-2.0.txt'),
  patches: readJson(path.join(CATALOG, 'patches.json'), {}),
});
fs.writeFileSync(path.join(CATALOG, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(MARKETPLACE, `${JSON.stringify(withPackEntries(marketplace, report.plugins), null, 2)}\n`);

process.stdout.write([
  `built ${report.built.length} packs and listed them in .claude-plugin/marketplace.json; ${report.inCore.length} live in the core plugin (${report.inCore.join(', ')})`,
  `overrides used: ${report.overridden.length} · patched files: ${report.patched.length} · missing sources: ${report.missing.length}`,
  `needs review: ${report.mentions.length} files still mention ECC, ${report.scripts.length} non-Markdown files, ${report.commandTokens.length} commands use argument tokens`,
  `dangling references: ${report.danglingReferences.length} (skills, agents or commands that neither a pack nor the core ships)`,
  'details: catalog/build-report.json',
  '',
].join('\n'));
if (report.patchFailures.length || report.unusedPatches.length) {
  fail(`${report.patchFailures.length} patches no longer match and ${report.unusedPatches.length} target files outside the registry; see catalog/build-report.json`);
}
// A pack that names a component nobody ships sends the model looking for something that is not there.
if (report.danglingReferences.length) fail(`${report.danglingReferences.length} dangling references; patch them in catalog/patches.json (see catalog/build-report.json)`);
