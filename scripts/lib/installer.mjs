// Installer core: environment checks, an analysis of the existing Claude Code setup, and install/uninstall plans.
// Claude Code's own settings are only ever changed through the `claude plugin ...` commands.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { findExecutable } from './codeindex.mjs';
import { GRAPHIFY_SPEC, GRAPHIFY_VERSION, graphifyCommand, graphifyHome, graphifyToolEnv } from './graphify.mjs';
import {
  codexFileTracked,
  codexStatus,
  hasProjectCodex,
  installProjectCodex,
  launcherDir,
  launcherFiles,
  onPath,
  PROJECT_CODEX_HOOKS,
  removeGlobalCodex,
  removeLaunchers,
  uninstallProjectCodex,
  writeLaunchers,
} from './codex.mjs';
import { effectiveSettings, PROFILE_LABEL, settingsFile, updateSettings } from './multiagent.mjs';
import { hasProjectOpenCode, installProjectOpenCode, PROJECT_OPENCODE_LOADER, uninstallProjectOpenCode } from './opencode.mjs';
import { MEMORY_DIRNAME, removeExcludePattern } from './project.mjs';
import { bundledRules, installedRules, installRules, packRuleFiles, projectRulesDir, syncPackRules, uninstallRules, unscopedBytes, userRulesDir } from './rules.mjs';
import { pluginDataDir, registeredProjects } from './runtime.mjs';
import { claudeConfigDir, exists, readJson, samePath, writeAtomic } from './util.mjs';

export const PLUGIN_ID = 'legacies@legacies';
export const MARKETPLACE = 'legacies';
// uv installs graphify (and, when the machine has none, the Python it needs). Pinned like every other tool.
export const UV_VERSION = '0.11.28';
export const MIN_NODE = 18;
export const TESTED_CLAUDE = '2.1.308';
export const TESTED_OPENCODE = '2.2.5';
const CONTEXT_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact'];

export const SCOPE_LABEL = { user: 'global', local: 'bu proje, yalnız bu bilgisayar', project: 'bu proje, ekiple paylaşılan', none: 'hiçbir proje (yalnız hazırlık)' };
// legacies is installed per project; `user` only names what earlier versions installed for every project.
export const INSTALL_SCOPES = ['local', 'project', 'none'];

export const manifestFile = () => path.join(claudeConfigDir(), 'legacies-install.json');
export const readManifest = () => readJson(manifestFile(), {}) || {};
export function writeManifest(data) {
  writeAtomic(manifestFile(), JSON.stringify({ ...readManifest(), ...data, updatedAt: new Date().toISOString() }, null, 2));
}

function resolveCommand(name, override) {
  if (override === '__none__') return null;
  if (override) return { cmd: process.execPath, pre: [override], shell: false };
  const exe = findExecutable(name);
  if (!exe) return null;
  return { cmd: exe, pre: [], shell: /\.(cmd|bat)$/i.test(exe) };
}

export const claudeCommand = () => resolveCommand('claude', process.env.LEGACIES_CLAUDE_BIN);
export const openCodeCommand = () => resolveCommand('opencode', process.env.LEGACIES_OPENCODE_BIN);

// uv's installer puts it in ~/.local/bin (or XDG_BIN_HOME); a shell started before the install may not
// have that folder on PATH yet.
function toolBinExecutable(name) {
  const dirs = [process.env.UV_TOOL_BIN_DIR, process.env.XDG_BIN_HOME, path.join(os.homedir(), '.local', 'bin')].filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

// uv may have just been installed by this run, before its folder reached PATH.
export function uvCommand() {
  const override = process.env.LEGACIES_UV_BIN;
  if (override) return resolveCommand('uv', override);
  const exe = findExecutable('uv') || toolBinExecutable('uv');
  return exe ? { cmd: exe, pre: [], shell: /\.(cmd|bat)$/i.test(exe) } : null;
}

// The version of legacies' own graphify, or null when it has none.
function installedGraphify() {
  const command = graphifyCommand();
  if (!command) return null;
  const res = spawnSync(command.cmd, [...command.pre, '--version'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  const m = /graphify\s+v?(\S+)/.exec(res.stdout || '');
  return { version: m ? m[1] : null };
}

// .cmd shims (npm-installed CLIs on Windows) need a shell; they get one pre-quoted command line,
// because Node deprecates passing an argument array together with shell: true (DEP0190).
const quoteWin = (a) => (/[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : String(a));
export function spawnCommand(command, args, options) {
  const all = [...command.pre, ...args];
  if (command.shell) return spawn([command.cmd, ...all].map(quoteWin).join(' '), { ...options, shell: true });
  return spawn(command.cmd, all, options);
}

export function run(command, args, { cwd, env, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawnCommand(command, args, { cwd, env, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const lastLines = (res) => `${res.stderr || ''}\n${res.stdout || ''}`.trim().split('\n').filter(Boolean).slice(-3).join(' · ');

export async function claude(args, opts = {}) {
  const command = claudeCommand();
  if (!command) throw new Error('Claude Code CLI (claude) bulunamadı');
  const res = await run(command, args, opts);
  if (res.code !== 0) throw new Error(lastLines(res) || `claude ${args.join(' ')} başarısız (${res.code})`);
  return res;
}

export function parseJsonOutput(text, fallback) {
  const s = String(text || '');
  const start = s.search(/[[{]/);
  if (start === -1) return fallback;
  try {
    return JSON.parse(s.slice(start));
  } catch {
    return fallback;
  }
}

function versionOf(command, args = ['--version']) {
  if (!command) return null;
  const options = { encoding: 'utf8', timeout: 20000, windowsHide: true };
  const all = [...command.pre, ...args];
  const res = command.shell
    ? spawnSync([command.cmd, ...all].map(quoteWin).join(' '), { ...options, shell: true })
    : spawnSync(command.cmd, all, options);
  if (res.status !== 0) return null;
  const m = /\d+\.\d+\.\d+/.exec(`${res.stdout} ${res.stderr}`);
  return m ? m[0] : null;
}

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
};

export function detectEnvironment() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const claudeCmd = claudeCommand();
  const codexCmd = resolveCommand('codex', process.env.LEGACIES_CODEX_BIN);
  const openCodeCmd = openCodeCommand();
  const codex = codexStatus();
  // A command that is on PATH but does not run (WSL sees Windows' npm shims) counts as missing.
  const claudeVersion = versionOf(claudeCmd);
  const codexVersion = versionOf(codexCmd);
  const openCodeVersion = versionOf(openCodeCmd);
  return {
    platform: process.platform,
    node: { version: process.versions.node, ok: nodeMajor >= MIN_NODE },
    git: versionOf(resolveCommand('git')),
    claude: claudeVersion ? { version: claudeVersion, tested: newer(claudeVersion, TESTED_CLAUDE) } : null,
    codex: codexVersion ? { version: codexVersion, home: codex.home, ready: codex.exists } : null,
    opencode: openCodeVersion ? { version: openCodeVersion, ready: Number(openCodeVersion.split('.')[0]) >= 2, tested: newer(openCodeVersion, TESTED_OPENCODE) } : null,
    uv: uvCommand() ? (process.env.LEGACIES_UV_BIN || findExecutable('uv') || toolBinExecutable('uv')) : null,
    graphify: installedGraphify(),
    launcherDir: launcherDir(),
    launcherOnPath: onPath(launcherDir()),
    configDir: claudeConfigDir(),
  };
}

// Astral's official installer for the pinned uv; it also puts uv's tool folder on PATH for new shells.
function uvInstallStep(platform) {
  const win = platform === 'win32';
  const url = `https://astral.sh/uv/${UV_VERSION}/install.${win ? 'ps1' : 'sh'}`;
  return {
    id: 'uv',
    title: `uv (graphify'ın Python araç yöneticisi)`,
    detail: url,
    change: true,
    run: async () => {
      const res = win
        ? await run({ cmd: 'powershell', pre: [], shell: false }, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${url} | iex`])
        : await run({ cmd: 'sh', pre: [], shell: false }, ['-c', `curl -LsSf ${url} | sh`]);
      if (res.code !== 0) throw new Error(lastLines(res));
      return UV_VERSION;
    },
  };
}

// How to get each prerequisite, per platform.
export function installHint(what, platform = process.platform) {
  const mac = platform === 'darwin';
  const win = platform === 'win32';
  const claude = win ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
  const opencode = win ? 'npm install -g @opencode/cli' : 'curl -fsSL https://opencode.ai/v2/install | bash';
  const hints = {
    node: win ? 'winget install OpenJS.NodeJS.LTS' : mac ? 'brew install node  (ya da https://nodejs.org)' : 'nvm ile kur: https://github.com/nvm-sh/nvm  (dağıtım paketi eski olabilir)',
    git: win ? 'winget install Git.Git' : mac ? 'xcode-select --install  (ya da brew install git)' : 'sudo apt install git  (Fedora: sudo dnf install git)',
    claude,
    host: `Claude Code: ${claude}  ·  OpenCode: ${opencode}`,
    uv: win ? 'winget install astral-sh.uv' : 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  };
  return hints[what];
}

export function missingRequirements(env) {
  const missing = [];
  if (!env.node.ok) missing.push({ what: 'node', text: `Node ${MIN_NODE}+ (bulunan: ${env.node.version})` });
  if (!env.git) missing.push({ what: 'git', text: 'git' });
  if (!env.claude && !env.opencode?.ready) missing.push({ what: 'host', text: 'Claude Code CLI (claude) veya OpenCode 2 CLI (opencode)' });
  return missing;
}

function skillNames(root) {
  try {
    return fs
      .readdirSync(path.join(root, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && exists(path.join(root, 'skills', e.name, 'SKILL.md')))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Reads the plugins Claude Code reports as enabled and flags what would overlap with legacies.
export async function analyzeClaude({ pluginRoot, cwd = os.homedir() }) {
  const report = { settings: { ok: true }, plugins: [], legacies: [], marketplace: null, userHooks: [], warnings: [], notes: [] };
  const settingsFile = path.join(claudeConfigDir(), 'settings.json');
  if (exists(settingsFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, ''));
      report.userHooks = Object.keys(settings.hooks || {});
    } catch (err) {
      report.settings = { ok: false, error: `${settingsFile} geçerli JSON değil (${err.message}). Claude Code bu dosyadaki ayarları yok sayıyor olabilir; önce düzelt.` };
      return report;
    }
  }
  const listed = parseJsonOutput((await claude(['plugin', 'list', '--json'], { cwd })).stdout, []);
  const markets = parseJsonOutput((await claude(['plugin', 'marketplace', 'list', '--json'], { cwd })).stdout, []);
  report.marketplace = markets.find((m) => m.name === MARKETPLACE) || null;
  report.legacies = listed.filter((p) => p.id === PLUGIN_ID);
  const ours = new Set(skillNames(pluginRoot));
  const seen = new Set();
  for (const p of listed) {
    if (p.id === PLUGIN_ID || !(p.enabled || p.projectEnabled) || seen.has(p.id)) continue;
    seen.add(p.id);
    const root = p.readFromFolder || p.installPath;
    const events = Object.keys((readJson(path.join(root, 'hooks', 'hooks.json'), {}) || {}).hooks || {});
    const skills = skillNames(root);
    report.plugins.push({ id: p.id, scope: p.scope, events, skills: skills.length });
    const contextEvents = events.filter((e) => CONTEXT_EVENTS.includes(e));
    if (/^ecc@/.test(p.id)) {
      report.warnings.push({
        id: p.id,
        ecc: true,
        text: `${p.id} etkin. Oturum hafızası legacies ile çakışır, GateGuard her yeni dosyada fazladan bir tur ister ve yüzlerce skill bağlamı doldurur.`,
        fix: `claude plugin disable ${p.id}`,
      });
    } else if (contextEvents.length) {
      report.warnings.push({
        id: p.id,
        text: `${p.id} de ${contextEvents.join(', ')} sırasında bağlam ekliyor; iki hafıza sistemi birlikte bağlamı şişirir.`,
        fix: `claude plugin disable ${p.id}`,
      });
    }
    if (events.includes('PreToolUse')) report.notes.push(`${p.id} da araç çağrılarını denetliyor; iki koruma yan yana çalışır, birbirini bozmaz.`);
    const same = skills.filter((s) => ours.has(s));
    if (same.length) {
      report.notes.push(`${p.id} aynı adlı skill'ler içeriyor (${same.slice(0, 3).join(', ')}${same.length > 3 ? '…' : ''}); ad alanları ayrı, bozulma olmaz ama model ikisini de görür.`);
    }
  }
  const userContext = report.userHooks.filter((e) => CONTEXT_EVENTS.includes(e));
  if (userContext.length) report.notes.push(`settings.json'daki kendi hook'ların da ${userContext.join(', ')} sırasında çalışıyor; legacies onlara dokunmaz.`);
  return report;
}

// What earlier versions installed for every project on this machine.
export function globalLeftovers(report) {
  const codex = codexStatus();
  return {
    plugin: report.legacies.some((e) => e.scope === 'user'),
    rules: installedRules(userRulesDir()),
    codex: codex.ourHooks || codex.agentsBlock,
  };
}

export const hasGlobalLeftovers = (found) => found.plugin || found.rules.length > 0 || found.codex;

function globalCleanupSteps(found) {
  const steps = [];
  if (found.plugin) {
    steps.push({
      id: 'global-plugin',
      title: "Eski global legacies plugin'i",
      // The plugin data folder is shared by every scope's install, so the project installs keep it.
      detail: `claude plugin uninstall ${PLUGIN_ID} --scope user --keep-data (hafızalar ve plugin verisi kalır)`,
      change: true,
      run: async () => {
        await claude(['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user', '--keep-data', '-y'], { cwd: os.homedir() });
        return 'kaldırıldı';
      },
    });
  }
  if (found.rules.length) {
    steps.push({ id: 'global-rules', title: 'Eski global kurallar', detail: `${found.rules.length} dosya: ${userRulesDir()} (yalnız legacies-*.md)`, change: true, run: async () => `${uninstallRules(userRulesDir())} dosya` });
  }
  if (found.codex) {
    steps.push({
      id: 'global-codex',
      title: "Codex'in eski global adaptörü",
      detail: `${codexStatus().home}: legacies hook'ları ve AGENTS.md bloğu (hooks.json önce yedeklenir)`,
      change: true,
      run: async () => (removeGlobalCodex(), 'diğer Codex ayarları korundu'),
    });
  }
  return steps;
}

// The multi-agent setup for this project (or, without one, this computer's default). A choice that
// matches the current settings changes nothing.
function multiagentStep({ target, change }, projectRoot) {
  const now = effectiveSettings(target === 'project' ? projectRoot : null).settings;
  const after = { ...now, ...change };
  const differs = Object.keys(change).some((k) => JSON.stringify(change[k]) !== JSON.stringify(now[k]));
  return {
    id: 'multiagent',
    title: `Çoklu ajan düzeni (${target === 'default' ? 'bilgisayar varsayılanı' : 'bu proje'})`,
    detail: after.on ? `açık · ${PROFILE_LABEL[after.profile] || after.profile}` : 'kapalı',
    change: differs,
    run: async () => {
      if (!differs) return { skipped: 'zaten böyle' };
      updateSettings({ root: projectRoot, target, change });
      return after.on ? 'açıldı' : 'kapatıldı';
    },
  };
}

// Install steps in order. `change: false` steps are shown but do nothing.
export function planInstall({ pluginRoot, env, report, options }) {
  const scriptPath = path.join(pluginRoot, 'scripts', 'legacies.mjs');
  const { scope, projectRoot } = options;
  const cwd = projectRoot || os.homedir();
  const inCache = pluginRoot.startsWith(path.join(claudeConfigDir(), 'plugins'));
  const market = report.marketplace;
  const marketPath = market && (market.path || market.installLocation);
  const registeredHere = Boolean(market) && samePath(marketPath, pluginRoot);
  const steps = [];

  if (env.claude && (inCache || (market && !registeredHere))) {
    const where = market ? marketPath || market.repo || market.url : 'plugin önbelleği';
    steps.push({ id: 'marketplace', title: 'Marketplace kaydı', detail: `zaten kayıtlı: ${where}`, change: false, run: async () => ({ skipped: 'zaten kayıtlı' }) });
  } else if (env.claude) {
    steps.push({
      id: 'marketplace',
      title: 'Marketplace kaydı',
      detail: registeredHere ? 'zaten kayıtlı' : `claude plugin marketplace add "${pluginRoot}"`,
      change: !registeredHere,
      run: async () => {
        if (registeredHere) return { skipped: 'zaten kayıtlı' };
        await claude(['plugin', 'marketplace', 'add', pluginRoot], { cwd });
        return 'eklendi';
      },
    });
  }

  const existing = env.claude && report.legacies.find((e) => e.scope === scope && samePath(e.projectPath, projectRoot));
  const active = Boolean(existing && (existing.enabled || existing.projectEnabled));
  // `none` only prepares the machine (marketplace, launcher, adapters); each project is set up later.
  if (env.claude && scope !== 'none') steps.push({
    id: 'plugin',
    title: `legacies plugin'i (${SCOPE_LABEL[scope]})`,
    detail: active ? 'zaten kurulu ve etkin' : existing ? 'kurulu ama kapalı: etkinleştirilecek' : `claude plugin install ${PLUGIN_ID} --scope ${scope}`,
    change: !active,
    critical: true,
    run: async () => {
      if (active) return { skipped: 'zaten kurulu ve etkin' };
      if (existing) {
        await claude(['plugin', 'enable', PLUGIN_ID, '--scope', scope], { cwd });
        return 'etkinleştirildi';
      }
      await claude(['plugin', 'install', PLUGIN_ID, '--scope', scope], { cwd });
      return 'kuruldu';
    },
  });

  for (const w of env.claude && options.disableEcc ? report.warnings.filter((x) => x.ecc) : []) {
    steps.push({
      id: 'ecc',
      title: `${w.id} devre dışı`,
      detail: `${w.fix} (kaldırılmaz; tek komutla geri açılır)`,
      change: true,
      run: async () => {
        await claude(['plugin', 'disable', w.id], { cwd: os.homedir() });
        return 'kapatıldı';
      },
    });
  }

  if (env.claude && options.rules && scope !== 'none') {
    const dir = projectRulesDir(projectRoot);
    const rules = bundledRules(pluginRoot);
    steps.push({
      id: 'rules',
      title: 'Kodlama kuralları',
      detail: `${rules.length} dosya → ${dir} (legacies-*.md; her oturuma ~${Math.round(unscopedBytes(rules) / 4)} token)`,
      change: true,
      run: async () => `${installRules(pluginRoot, dir, { projectRoot }).count} kural`,
    });
  }

  if (options.launcher) {
    steps.push({
      id: 'launcher',
      title: "Her terminalde 'legacies' komutu",
      detail: `${launcherDir()}${env.launcherOnPath ? '' : " (PATH'te değil: sonunda nasıl ekleneceğini gösteririm)"}`,
      change: true,
      run: async () => {
        writeLaunchers(scriptPath);
        return launcherDir();
      },
    });
  }

  if (options.codex && scope !== 'none') {
    steps.push({
      id: 'codex',
      title: 'Codex adaptörü (bu proje)',
      detail: `${PROJECT_CODEX_HOOKS} (git'e girmez; Codex'te /hooks ile onaylanır)`,
      change: true,
      run: async () => {
        if (codexFileTracked(projectRoot)) return { skipped: `${PROJECT_CODEX_HOOKS} git'te takip ediliyor; dokunulmadı` };
        installProjectCodex(scriptPath, projectRoot);
        return 'kuruldu';
      },
    });
  }

  if (options.opencode && scope !== 'none') {
    steps.push({
      id: 'opencode',
      title: 'OpenCode adaptörü (bu proje)',
      detail: `${PROJECT_OPENCODE_LOADER} (git'e girmez; diğer OpenCode plugin'lerine dokunulmaz)`,
      change: true,
      run: async () => {
        installProjectOpenCode(path.join(pluginRoot, 'opencode', 'index.mjs'), projectRoot);
        return 'kuruldu';
      },
    });
  }

  if (options.multiagent) steps.push(multiagentStep(options.multiagent, projectRoot));

  // graphify is part of legacies, not an option: the pinned version goes into legacies' own folder
  // unless --no-graphify.
  if (options.graphify) {
    if (!env.uv) steps.push(uvInstallStep(env.platform));
    const current = env.graphify?.version === GRAPHIFY_VERSION;
    steps.push({
      id: 'graphify',
      title: 'graphify (kod haritası motoru)',
      detail: current ? `${GRAPHIFY_VERSION} kurulu` : `uv tool install ${GRAPHIFY_SPEC} → ${graphifyHome()}`,
      change: !current,
      run: async () => {
        if (current) return { skipped: `${GRAPHIFY_VERSION} zaten kurulu` };
        const uv = uvCommand();
        if (!uv) throw new Error('uv bulunamadı; graphify kurulamadı');
        const res = await run(uv, ['tool', 'install', '--force', GRAPHIFY_SPEC], { env: graphifyToolEnv(), timeout: 15 * 60 * 1000 });
        if (res.code !== 0) throw new Error(lastLines(res));
        return GRAPHIFY_VERSION;
      },
    });
  }

  // After the project install, so a failed install never leaves the machine without legacies.
  if (options.removeGlobal) steps.push(...globalCleanupSteps(options.leftovers));

  if (env.claude && scope !== 'none') steps.push({
    id: 'verify',
    title: 'Doğrulama',
    detail: 'Claude Code legacies\'i etkin görüyor mu?',
    change: false,
    run: async () => {
      const listed = parseJsonOutput((await claude(['plugin', 'list', '--json'], { cwd })).stdout, []);
      const ok = listed.some((p) => p.id === PLUGIN_ID && p.scope === scope && (p.enabled || p.projectEnabled));
      if (!ok) throw new Error('legacies plugin listesinde etkin görünmüyor');
      return 'legacies etkin';
    },
  });

  const disabled = steps.filter((s) => s.id === 'ecc').length ? report.warnings.filter((w) => w.ecc).map((w) => w.id) : [];
  const untouched = env.claude
    ? [
        `Diğer plugin'ler ve ayarları${disabled.length ? ` (${disabled.join(', ')} yalnız kapatılır, silinmez)` : ''}`,
        'settings.json\'daki kendi hook\'ların, izinlerin ve env değişkenlerin (Claude Code yalnız legacies kaydını ekler)',
        'Projelerindeki dosyalar ve CLAUDE.md\'ler (hafıza yalnızca /legacies:onboard ile, .legacies/ içine kurulur)',
        `Kendi kuralların (legacies yalnız legacies-*.md yazar)`,
      ]
    : ['Projelerindeki kaynak dosyalar (.legacies/ hafızası yalnız onboard sırasında oluşturulur)'];
  if (options.codex && scope !== 'none') untouched.push("Codex ayarların ve projedeki diğer Codex hook'ları (yalnız legacies girdileri eklenir)");
  if (options.opencode && scope !== 'none') untouched.push("OpenCode ayarların ve projedeki diğer OpenCode plugin'leri (yalnız legacies.js eklenir)");
  if (options.graphify) untouched.push('Kendi kurduğun bir graphify varsa o (legacies kendi kopyasını kendi klasöründe tutar)');
  return { steps, untouched };
}

// Everything legacies may have put on this machine, found before anything is removed.
export async function detectInstalled({ pluginRoot }) {
  const scriptPath = path.join(pluginRoot, 'scripts', 'legacies.mjs');
  const manifest = readManifest();
  let listed = [];
  let markets = [];
  if (claudeCommand()) {
    listed = parseJsonOutput((await claude(['plugin', 'list', '--json'], { cwd: os.homedir() })).stdout, []);
    markets = parseJsonOutput((await claude(['plugin', 'marketplace', 'list', '--json'], { cwd: os.homedir() })).stdout, []);
  }
  const roots = new Set([...registeredProjects(), ...((manifest.scopes || []).map((s) => s.projectRoot).filter(Boolean))]);
  for (const p of listed) if (p.id === PLUGIN_ID && p.projectPath) roots.add(p.projectPath);
  const projects = [...roots]
    .map((root) => ({
      root,
      memory: exists(path.join(root, MEMORY_DIRNAME)),
      rules: installedRules(projectRulesDir(root)).length > 0,
      packRules: packRuleFiles(root).length > 0,
      codex: hasProjectCodex(root),
      opencode: hasProjectOpenCode(root),
    }))
    .filter((p) => p.memory || p.rules || p.packRules || p.codex || p.opencode);
  const codex = codexStatus();
  return {
    manifest,
    plugins: listed.filter((p) => p.id === PLUGIN_ID),
    marketplace: markets.find((m) => m.name === MARKETPLACE) || null,
    userRules: installedRules(userRulesDir()),
    projects,
    launchers: launcherFiles(scriptPath),
    codex: codex.ourHooks || codex.agentsBlock ? codex : null,
    dataDir: exists(pluginDataDir()) ? pluginDataDir() : null,
    graphify: exists(graphifyHome()) ? graphifyHome() : null,
    eccDisabled: manifest.eccDisabledByUs || [],
  };
}

export function nothingInstalled(found) {
  return !found.plugins.length && !found.marketplace && !found.userRules.length && !found.projects.length && !found.launchers.length && !found.codex && !found.dataDir;
}

export function planUninstall({ pluginRoot, found, options }) {
  const scriptPath = path.join(pluginRoot, 'scripts', 'legacies.mjs');
  const steps = [];
  for (const p of found.plugins) {
    steps.push({
      title: `legacies plugin'i (${SCOPE_LABEL[p.scope] || p.scope}${p.projectPath ? `: ${p.projectPath}` : ''})`,
      run: async () => {
        await claude(['plugin', 'uninstall', PLUGIN_ID, '--scope', p.scope, '-y'], { cwd: p.projectPath || os.homedir() });
        return 'kaldırıldı';
      },
    });
  }
  if (found.marketplace) {
    steps.push({
      title: 'Marketplace kaydı',
      run: async () => {
        await claude(['plugin', 'marketplace', 'remove', MARKETPLACE], { cwd: os.homedir() });
        return 'kaynak klasöre dokunulmadı';
      },
    });
  }
  if (found.userRules.length) steps.push({ title: `Global kurallar (${found.userRules.length} dosya)`, run: async () => `${uninstallRules(userRulesDir())} dosya` });
  for (const p of found.projects.filter((x) => x.rules)) {
    steps.push({ title: `Proje kuralları: ${p.root}`, run: async () => `${uninstallRules(projectRulesDir(p.root), { projectRoot: p.root })} dosya` });
  }
  // Removing the marketplace uninstalls the pack plugins; the rule files they copied go here.
  for (const p of found.projects.filter((x) => x.packRules)) {
    steps.push({ title: `Paket kuralları: ${p.root}`, run: async () => `${syncPackRules(pluginRoot, p.root, [], { exclude: false }).removed} dosya` });
  }
  for (const p of found.projects.filter((x) => x.codex)) {
    steps.push({ title: `Codex hook'ları: ${p.root}`, run: async () => (uninstallProjectCodex(p.root), 'diğer hook\'lar korundu') });
  }
  for (const p of found.projects.filter((x) => x.opencode)) {
    steps.push({ title: `OpenCode adaptörü: ${p.root}`, run: async () => (uninstallProjectOpenCode(p.root), 'diğer OpenCode plugin\'leri korundu') });
  }
  if (found.launchers.length) steps.push({ title: "'legacies' komutu", run: async () => (removeLaunchers(scriptPath), launcherDir()) });
  if (found.codex) steps.push({ title: "Codex'in eski global adaptörü", run: async () => (removeGlobalCodex(), 'diğer Codex ayarları korundu') });
  for (const root of options.memories || []) {
    steps.push({
      title: `Proje hafızası: ${root}`,
      run: async () => {
        fs.rmSync(path.join(root, MEMORY_DIRNAME), { recursive: true, force: true });
        removeExcludePattern(root, `/${MEMORY_DIRNAME}/`);
        return '.legacies silindi (kod grafı dahil)';
      },
    });
  }
  for (const id of options.restoreEcc ? found.eccDisabled : []) {
    steps.push({ title: `${id} yeniden etkin`, run: async () => (await claude(['plugin', 'enable', id], { cwd: os.homedir() }), 'açıldı') });
  }
  // legacies' own graphify lives in the plugin data, so it leaves here too; one the user installed stays.
  steps.push({
    title: found.graphify ? 'Kayıt ve veri dosyaları (legacies\'in graphify kopyası dahil)' : 'Kayıt ve veri dosyaları',
    run: async () => {
      fs.rmSync(pluginDataDir(), { recursive: true, force: true });
      fs.rmSync(manifestFile(), { force: true });
      fs.rmSync(settingsFile(), { force: true });
      return 'temizlendi';
    },
  });
  return { steps };
}
