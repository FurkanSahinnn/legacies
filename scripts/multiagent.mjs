#!/usr/bin/env node
// `legacies multiagent`: turn the multi-agent setup on or off and set it up, for this project or as this
// computer's default. Without a command, a terminal gets the settings screen and anything else the status.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveSettings, updateSettings } from './lib/multiagent.mjs';
import { applyCommand, changeFromDraft, chooseSettings, statusLines, UsageError } from './lib/multiagentflow.mjs';
import { findProjectRoot } from './lib/project.mjs';
import * as ui from './lib/tui.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (text) => process.stdout.write(`${text}\n`);

async function main(argv) {
  const words = argv.filter((a) => !a.startsWith('--'));
  const target = words[0] === 'default' ? 'default' : 'project';
  if (target === 'default') words.shift();
  const root = target === 'project' ? findProjectRoot(process.cwd()) : null;
  if (target === 'project' && !root) throw new UsageError('Proje klasörü bulunamadı. Bu bilgisayarın varsayılanı için: legacies multiagent default ...');
  const where = target === 'default' ? 'bilgisayar varsayılanı' : `bu proje: ${path.basename(root)}`;
  const [action] = words;
  if (!action && ui.interactive) {
    const draft = await chooseSettings({ pluginRoot: PLUGIN_ROOT, root, initial: effectiveSettings(root).settings, title: `Çoklu ajan düzeni (${where})` });
    updateSettings({ root, target, change: changeFromDraft(draft) });
    ui.item('ok', 'Kaydedildi', 'yeni oturumda geçerli');
    return;
  }
  const changed = Boolean(action) && action !== 'status';
  if (changed) applyCommand({ root, target, words });
  const current = effectiveSettings(root);
  for (const line of statusLines(target === 'project' ? current : { settings: current.settings }, where)) out(line);
  if (changed) out('Yeni oturumda geçerli.');
}

main(process.argv.slice(3)).catch((err) => {
  process.stderr.write(`legacies multiagent: ${err.message}\n`);
  process.exitCode = err instanceof UsageError ? 2 : 1;
});
