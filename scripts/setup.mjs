#!/usr/bin/env node
// legacies installer and uninstaller. Run it through install.sh / install.cmd, `legacies setup` or `legacies uninstall`.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_CODEX_HOOKS } from './lib/codex.mjs';
import { GRAPHIFY_VERSION } from './lib/graphify.mjs';
import {
  analyzeClaude,
  detectEnvironment,
  detectInstalled,
  globalLeftovers,
  hasGlobalLeftovers,
  INSTALL_SCOPES,
  installHint,
  missingRequirements,
  nothingInstalled,
  planInstall,
  planUninstall,
  readManifest,
  SCOPE_LABEL,
  TESTED_CLAUDE,
  writeManifest,
} from './lib/installer.mjs';
import { effectiveSettings } from './lib/multiagent.mjs';
import { changeFromDraft, chooseSettings } from './lib/multiagentflow.mjs';
import { choosePacks } from './lib/packflow.mjs';
import { findProjectRoot } from './lib/project.mjs';
import { bundledRules, unscopedBytes } from './lib/rules.mjs';
import * as ui from './lib/tui.mjs';
import { readJson, samePath } from './lib/util.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = (readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), {}) || {}).version || '?';

const HELP = `legacies kurulum programı

Kullanım:
  install.sh | install.cmd | legacies setup      kurulum (etkileşimli)
  uninstall.sh | uninstall.cmd | legacies uninstall   tamamen kaldırma

Kurulum seçenekleri (etkileşimsiz kullanım için):
  --yes                 soruları varsayılanlarla geç
  --dry-run             yalnız analiz ve planı göster, hiçbir şeyi değiştirme
  --scope local|project|none   bu proje (yalnız bu bilgisayar; önerilen), bu proje (ekiple),
                        hiçbir proje (yalnız hazırlık). Global kurulum yok: legacies proje başına kurulur
  --packs | --no-packs  kurulumdan sonra bu projenin teknoloji paketlerini seç (etkileşimli kurulumda varsayılan)
  --keep-global         eski sürümlerin global kurulumunu kaldırma (varsayılan: kaldırılır)
  --no-rules  --no-launcher  --codex  --no-codex
  --no-graphify         kod haritası motorunu (graphify) kurma; varsayılan: kurulur
  --multiagent | --no-multiagent  çoklu ajan düzenini aç ya da kapat (plugin klasöründe: bilgisayar
                        varsayılanı). Dengeyi sonradan: legacies multiagent on <denge>
  --disable-ecc         etkin ECC plugin'ini kapat
  --no-anim             animasyonsuz, düz çıktı

Kaldırma seçenekleri:
  --yes                 onay sormadan kaldır (hafızalar yine silinmez)
  --delete-memories     kayıtlı tüm projelerin .legacies/ klasörlerini de sil (kod grafı dahil)
`;

const BALANCES = [
  { value: 'dengeli', label: 'Dengeli', hint: 'önerilen · inceleme ve tasarım senin modelinle, uygulama Sonnet, arama Haiku' },
  { value: 'kalite', label: 'Kalite', hint: 'uygulama da senin modelinle; daha pahalı' },
  { value: 'maliyet', label: 'Maliyet', hint: 'Sonnet ve Haiku; daha ucuz, daha az titiz' },
  { value: 'ozel', label: 'Özel', hint: 'her rolü kendin seç' },
];

// Turning the multi-agent setup on in the installer asks for its balance; "Özel" opens the settings
// screen. Nothing is saved here: the plan step saves it after the user approves the plan.
async function chooseMultiagent({ on, ask, now, projectRoot }) {
  if (!on || !ask) return { on };
  const profile = await ui.select('Çoklu ajan düzeni: hangi denge?', BALANCES, { initial: Math.max(0, BALANCES.findIndex((b) => b.value === now.profile)) });
  if (profile !== 'ozel') return { on: true, profile };
  return changeFromDraft(await chooseSettings({ pluginRoot: PLUGIN_ROOT, root: projectRoot, initial: { ...now, on: true, profile } }));
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) flags._.push(a);
    else if (a === '--scope') flags.scope = argv[(i += 1)];
    else if (a.startsWith('--no-')) flags[a.slice(5)] = false;
    else flags[a.slice(2)] = true;
  }
  return flags;
}

function printEnvironment(env) {
  ui.item(env.node.ok ? 'ok' : 'fail', `Node ${env.node.version}`, env.node.ok ? 'en az 18' : 'en az 18 gerekli');
  ui.item(env.git ? 'ok' : 'fail', env.git ? `git ${env.git}` : 'git bulunamadı');
  if (env.claude) ui.item(env.claude.tested ? 'ok' : 'warn', `Claude Code ${env.claude.version}`, env.claude.tested ? '' : `${TESTED_CLAUDE} ve sonrasıyla test edildi`);
  else ui.item('fail', 'Claude Code CLI bulunamadı');
  ui.item(env.codex ? 'ok' : 'skip', env.codex ? `Codex CLI ${env.codex.version}` : 'Codex CLI yok', 'isteğe bağlı');
  if (env.graphify?.version === GRAPHIFY_VERSION) ui.item('ok', `graphify ${GRAPHIFY_VERSION}`, 'kod haritası');
  else ui.item('info', `graphify ${GRAPHIFY_VERSION} kurulacak`, env.uv ? 'kod haritası; uv ile' : 'kod haritası; önce uv kurulacak');
}

function printReport(report) {
  ui.item('ok', 'settings.json geçerli');
  const others = report.plugins.map((p) => p.id);
  ui.item('info', others.length ? `Etkin diğer plugin'ler: ${others.join(', ')}` : 'Başka etkin plugin yok');
  if (report.legacies.length) {
    for (const e of report.legacies) ui.item('info', `legacies zaten kurulu (${SCOPE_LABEL[e.scope] || e.scope})`, e.readFromFolder ? `kaynak: ${e.readFromFolder}` : `sürüm ${e.version}`);
  }
  for (const w of report.warnings) {
    ui.item('warn', w.text);
    ui.detail(`öneri: ${w.fix}`);
  }
  for (const n of report.notes) ui.item('info', n);
  if (!report.warnings.length) ui.item('ok', 'legacies ile çakışan bir hafıza sistemi yok');
}

// The user-level Path is read on its own: $env:Path also holds the machine Path, which must not be copied into it.
function pathAdvice(dir) {
  if (process.platform === 'win32') {
    return [`$p = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', "$p;${dir}", 'User')`];
  }
  const home = os.homedir();
  const shown = dir.startsWith(`${home}/`) ? `$HOME${dir.slice(home.length)}` : dir;
  const shell = path.basename(process.env.SHELL || 'bash');
  const rc = shell === 'zsh' ? '~/.zshrc' : '~/.bashrc';
  return shell === 'fish' ? [`fish_add_path ${shown}`] : [`echo 'export PATH="${shown}:$PATH"' >> ${rc} && source ${rc}`];
}

async function install(flags) {
  await ui.banner(`v${VERSION} · projeye özel yerel hafıza · kurulum`);
  if (flags.scope === 'user') {
    ui.box('Global kurulum yok', ['legacies proje başına kurulur: her proje çekirdeği ve kendi', 'teknoloji paketlerini alır, diğer projeler bağlam harcamaz.', '', 'Projenin klasöründe: legacies setup'], { tone: 'fail' });
    process.exitCode = 2;
    return;
  }

  ui.section('Sistem kontrolü');
  const env = (await ui.task('Sistem taranıyor', async () => detectEnvironment(), { minMs: 600 })).result;
  printEnvironment(env);
  const missing = missingRequirements(env);
  if (missing.length) {
    ui.section('Önce bunları kur');
    for (const m of missing) {
      ui.item('fail', m.text);
      ui.detail(installHint(m.what, env.platform));
    }
    ui.box('Kurulum yapılmadı', ['Eksikleri kurup bu komutu yeniden çalıştır.', 'Bilgisayarında hiçbir şey değiştirilmedi.'], { tone: 'fail' });
    process.exitCode = 1;
    return;
  }

  const projectRoot = findProjectRoot(process.cwd());
  // install.sh runs in the plugin's own folder: there it only prepares the machine, unless asked otherwise.
  const inPluginFolder = samePath(projectRoot, PLUGIN_ROOT);
  ui.section('Mevcut Claude Code kurulumu');
  const analysis = await ui.task('Plugin\'ler, hook\'lar ve skill\'ler inceleniyor', () => analyzeClaude({ pluginRoot: PLUGIN_ROOT, cwd: projectRoot || os.homedir() }), { minMs: 700 });
  if (!analysis.ok) {
    ui.box('Analiz başarısız', [String(analysis.error.message)], { tone: 'fail' });
    process.exitCode = 1;
    return;
  }
  const report = analysis.result;
  if (!report.settings.ok) {
    ui.item('fail', report.settings.error);
    process.exitCode = 1;
    return;
  }
  printReport(report);
  const leftovers = globalLeftovers(report);
  if (hasGlobalLeftovers(leftovers)) {
    const parts = [leftovers.plugin && 'plugin (her projede yüklenir)', leftovers.rules.length && `${leftovers.rules.length} kural (~/.claude/rules)`, leftovers.codex && 'Codex adaptörü (~/.codex)'];
    ui.item('warn', `Eski sürümden global kurulum: ${parts.filter(Boolean).join(', ')}`);
    ui.detail('legacies artık proje başına kurulur; global parçalar her projede bağlam harcar.');
  }

  ui.section('Seçenekler');
  // Per project only: the packs a project needs depend on its stack, and other projects pay nothing.
  const scopes = [
    { value: 'local', label: 'Yalnız bu projede, yalnız bu bilgisayarda', hint: projectRoot && !inPluginFolder ? `önerilen · ${path.basename(projectRoot)}` : '', disabled: !projectRoot },
    { value: 'project', label: 'Bu projede, ekiple paylaşılan', hint: '.claude/settings.json commit\'lenir', disabled: !projectRoot },
    { value: 'none', label: 'Şimdilik hiçbir projeye kurma', hint: `${inPluginFolder ? 'önerilen · ' : ''}marketplace ve legacies komutu hazırlanır; projede: legacies setup`, disabled: Boolean(projectRoot) && !inPluginFolder },
  ];
  const usable = scopes.filter((s) => !s.disabled).map((s) => s.value);
  const scope = INSTALL_SCOPES.includes(flags.scope) ? flags.scope : await ui.select('legacies nerede çalışsın?', scopes, { initial: inPluginFolder ? usable.indexOf('none') : 0 });
  if ((scope === 'local' || scope === 'project') && !projectRoot) {
    ui.item('fail', 'Proje bazlı kurulum için bu komutu projenin klasöründe çalıştır.');
    process.exitCode = 2;
    return;
  }
  const rules = bundledRules(PLUGIN_ROOT);
  const codexPossible = Boolean(env.codex?.ready) && scope !== 'none';
  // Without a project the multi-agent choice becomes this computer's default for every project.
  const multiagentTarget = scope === 'none' ? 'default' : 'project';
  const multiagentNow = effectiveSettings(multiagentTarget === 'project' ? projectRoot : null).settings;
  const defaults = {
    rules: flags.rules ?? true,
    launcher: flags.launcher ?? true,
    codex: flags.codex ?? codexPossible,
    multiagent: flags.multiagent ?? multiagentNow.on,
  };
  const askComponents = !flags.yes && ['rules', 'launcher', 'codex', 'multiagent'].every((k) => flags[k] === undefined);
  const chosen = askComponents
    ? await ui.multiselect('Ek bileşenler', [
        { value: 'rules', label: 'Kodlama kuralları', hint: `${rules.length} dosya, her oturuma ~${Math.round(unscopedBytes(rules) / 4)} token`, checked: defaults.rules },
        { value: 'launcher', label: "Her terminalde 'legacies' komutu", hint: env.launcherDir, checked: defaults.launcher },
        { value: 'codex', label: 'Codex adaptörü (bu proje)', hint: !env.codex?.ready ? 'Codex yok' : scope === 'none' ? 'proje seçilmedi' : `${PROJECT_CODEX_HOOKS}, Codex'te /hooks ile onaylanır`, checked: defaults.codex, disabled: !codexPossible },
        { value: 'multiagent', label: 'Çoklu ajan düzeni', hint: `${multiagentTarget === 'default' ? 'bilgisayar varsayılanı' : 'bu proje'}; lider ajanlara işe göre model ve effort verir · sonradan: legacies multiagent`, checked: defaults.multiagent },
      ])
    : Object.keys(defaults).filter((k) => defaults[k] && (k !== 'codex' || codexPossible));
  const multiagent = await chooseMultiagent({ on: chosen.includes('multiagent'), ask: askComponents, now: multiagentNow, projectRoot });
  const ecc = report.warnings.find((w) => w.ecc);
  const disableEcc = ecc ? (flags['disable-ecc'] ?? (flags.yes ? false : await ui.confirm(`${ecc.id} kapatılsın mı? Çakışmayı önler, kaldırmaz.`, { initial: false }))) : false;
  const removeGlobal = hasGlobalLeftovers(leftovers) && !flags['keep-global'] && (flags.yes || (await ui.confirm('Eski global kurulum kaldırılsın mı? Hafızalar ve plugin verisi kalır.', { initial: true })));
  const options = {
    scope,
    projectRoot,
    disableEcc,
    removeGlobal,
    leftovers,
    ...Object.fromEntries(['rules', 'launcher', 'codex'].map((k) => [k, chosen.includes(k)])),
    graphify: flags.graphify !== false,
    multiagent: { target: multiagentTarget, change: multiagent },
  };

  ui.section('Yapılacaklar');
  const plan = planInstall({ pluginRoot: PLUGIN_ROOT, env, report, options });
  for (const step of plan.steps) ui.item(step.change ? 'add' : 'skip', step.title, step.detail);
  ui.section('Dokunulmayacaklar');
  for (const u of plan.untouched) ui.item('keep', u);

  if (flags['dry-run']) {
    ui.box('Deneme modu', ['--dry-run: analiz ve plan gösterildi, hiçbir şey değiştirilmedi.']);
    return;
  }
  if (!flags.yes && !(await ui.confirm('Kurulum başlasın mı?', { initial: true }))) {
    ui.item('info', 'Vazgeçildi; hiçbir şey değiştirilmedi.');
    return;
  }

  ui.section('Kuruluyor');
  const done = [];
  let failed = null;
  for (const step of plan.steps) {
    const r = await ui.task(step.title, step.run);
    if (r.ok) done.push(step.id);
    else if (step.critical) {
      failed = step;
      break;
    } else failed = failed || step;
  }

  const previous = readManifest();
  const kept = (previous.scopes || []).filter((s) => !(s.scope === scope && s.projectRoot === projectRoot) && !(s.scope === 'user' && done.includes('global-plugin')));
  writeManifest({
    version: VERSION,
    pluginRoot: PLUGIN_ROOT,
    scopes: scope === 'none' ? kept : [...kept, { scope, projectRoot }],
    eccDisabledByUs: [...new Set([...(previous.eccDisabledByUs || []), ...(done.includes('ecc') ? [ecc.id] : [])])],
  });

  // The project's stack decides its packs; interactive installs go straight to the checklist,
  // a scripted one only with --packs.
  const packsHere = !failed && projectRoot && (scope === 'local' || scope === 'project') && flags.packs !== false && (flags.packs || (!flags.yes && ui.interactive));
  if (packsHere) await choosePacks({ pluginRoot: PLUGIN_ROOT, root: projectRoot, scope, yes: Boolean(flags.yes) });

  const pathCommands = done.includes('launcher') && !env.launcherOnPath ? pathAdvice(env.launcherDir) : [];
  const steps =
    scope === 'none'
      ? ['Her projenin klasöründe: legacies setup (çekirdek + o projenin paketleri).', "Sonra Claude Code'u o klasörde aç ve /legacies:onboard çalıştır."]
      : [
          "Claude Code'u bu projenin klasöründe aç (alt ya da üst klasörde legacies yüklenmez); açık bir oturumda /reload-plugins.",
          'İlk oturumda /legacies:onboard: proje bir kez incelenip hafızası kurulur.',
          'Paketleri sonradan değiştirmek için: legacies packs',
        ];
  if (done.includes('global-plugin')) steps.push("legacies'i kullandığın diğer projelerde bir kez: legacies setup");
  if (pathCommands.length) steps.push("'legacies' komutu için PATH'e ekle; komut kutunun altında.");
  if (done.includes('codex')) steps.push("Codex'te bu projeyi aç, güven ve /hooks ekranında legacies hook'larını onayla.");
  const uninstaller = process.platform === 'win32' ? '.\\uninstall.cmd' : './uninstall.sh';
  const next = [
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `Kullanım rehberi: ${path.join(PLUGIN_ROOT, 'docs', 'KULLANIM.md')}`,
    `Kaldırmak için: legacies uninstall  (ya da plugin klasöründe ${uninstaller})`,
  ];
  if (failed) ui.box(`Kurulum yarım kaldı: ${failed.title}`, ['Yukarıdaki hatayı düzeltip komutu yeniden çalıştır;', 'tamamlanan adımlar tekrar yapılmaz.'], { tone: 'fail' });
  else {
    ui.box(`legacies ${VERSION} kuruldu`, next);
    if (pathCommands.length) {
      ui.item('info', `PATH'e ${env.launcherDir} eklemek için çalıştır, sonra yeni bir terminal aç:`);
      for (const cmd of pathCommands) ui.command(cmd);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

async function uninstall(flags) {
  await ui.banner(`v${VERSION} · kaldırma`);
  ui.section('Bilgisayardaki legacies parçaları');
  const scan = await ui.task('Aranıyor', () => detectInstalled({ pluginRoot: PLUGIN_ROOT }), { minMs: 600 });
  if (!scan.ok) {
    ui.box('Tarama başarısız', [String(scan.error.message)], { tone: 'fail' });
    process.exitCode = 1;
    return;
  }
  const found = scan.result;
  if (nothingInstalled(found)) {
    ui.box('Kaldırılacak bir şey yok', ['legacies bu bilgisayarda kurulu görünmüyor.']);
    return;
  }
  for (const p of found.plugins) ui.item('info', `Plugin: ${SCOPE_LABEL[p.scope] || p.scope}`, p.projectPath || '');
  if (found.marketplace) ui.item('info', 'Marketplace kaydı', found.marketplace.path || found.marketplace.repo || '');
  if (found.userRules.length) ui.item('info', `Global kurallar: ${found.userRules.length} dosya`);
  if (found.launchers.length) ui.item('info', "'legacies' komutu", found.launchers.join(', '));
  if (found.codex) ui.item('info', "Codex'in eski global adaptörü", found.codex.home);
  for (const p of found.projects) ui.item('info', `Proje: ${p.root}`, [p.memory && 'hafıza', p.rules && 'kurallar', p.codex && "Codex hook'ları"].filter(Boolean).join(' + '));
  if (found.graphify) ui.item('info', "legacies'in graphify kopyası", found.graphify);

  ui.section('Seçenekler');
  const withMemory = found.projects.filter((p) => p.memory);
  let memories = [];
  if (flags['delete-memories']) memories = withMemory.map((p) => p.root);
  else if (withMemory.length && !flags.yes) {
    memories = await ui.multiselect('Silinecek proje hafızaları (hafızalar senin verindir; varsayılan: hiçbiri)', withMemory.map((p) => ({ value: p.root, label: p.root, hint: '.legacies (kod grafı dahil)', checked: false })));
  }
  if (!withMemory.length) ui.item('skip', 'Silinecek proje hafızası yok');
  else if (!memories.length) ui.item('keep', `${withMemory.length} projenin hafızası korunacak`);
  const restoreEcc = found.eccDisabled.length ? (flags.yes ? true : await ui.confirm(`Kurulumda kapatılan ${found.eccDisabled.join(', ')} yeniden açılsın mı?`, { initial: true })) : false;

  const plan = planUninstall({ pluginRoot: PLUGIN_ROOT, found, options: { memories, restoreEcc } });
  ui.section('Kaldırılacaklar');
  for (const step of plan.steps) ui.item('remove', step.title);
  ui.item('keep', `Kaynak klasör silinmez: ${PLUGIN_ROOT}`);
  if (!flags.yes && !(await ui.confirm('Kaldırma başlasın mı? Bu işlem geri alınamaz.', { initial: false }))) {
    ui.item('info', 'Vazgeçildi; hiçbir şey değiştirilmedi.');
    return;
  }

  ui.section('Kaldırılıyor');
  let failures = 0;
  for (const step of plan.steps) if (!(await ui.task(step.title, step.run)).ok) failures += 1;
  if (failures) ui.box('Kaldırma kısmen tamamlandı', [`${failures} adım başarısız oldu; yukarıdaki hataları kontrol et.`], { tone: 'warn' });
  else {
    ui.box('legacies kaldırıldı', [
      "Claude Code'u yeniden başlat; legacies'in hook'ları ve skill'leri artık yüklenmez.",
      memories.length ? `${memories.length} projenin hafızası silindi.` : 'Proje hafızaları korundu (.legacies/ klasörleri).',
      'Çalışma alanlarının ortak hafızası (~/.claude/legacies-workspaces) ve kişisel katalog (~/.claude/legacies-catalog) da korundu.',
      '',
      'Kaynak klasörü istersen elle silebilirsin:',
      `  ${PLUGIN_ROOT}`,
    ]);
  }
  process.exitCode = failures ? 1 : 0;
}

const flags = parseFlags(process.argv.slice(2));
const mode = flags._[0] || 'install';
ui.setAnimation(flags.anim !== false);
if (flags.help || mode === 'help') process.stdout.write(HELP);
else if (mode === 'uninstall') await uninstall(flags);
else if (mode === 'install' || mode === 'check') await install(mode === 'check' ? { ...flags, 'dry-run': true } : flags);
else {
  process.stdout.write(HELP);
  process.exitCode = 2;
}
