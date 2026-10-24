import path from 'node:path';
import { exists } from './util.mjs';

// Git subcommands whose hooks --no-verify would skip.
const HOOKED_SUBCOMMANDS = new Set(['commit', 'push', 'merge', 'rebase', 'am', 'cherry-pick', 'revert', 'pull']);

// Splits a shell command into tokens, keeping quoted strings together. Good enough to find git flags.
function shellTokens(command) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

function isNoVerifyFlag(token) {
  return token.length >= '--no-v'.length && '--no-verify'.startsWith(token);
}

// `-n` and clusters like `-nm` mean --no-verify for commit; in `-mn` the n is the message.
function isCommitShortNoVerify(token) {
  if (!/^-[A-Za-z]+$/.test(token) || !token.includes('n')) return false;
  const before = token.slice(1, token.indexOf('n'));
  return !/[mFCct]/.test(before);
}

export function checkShellCommand(command) {
  const text = String(command || '');
  if (!/\bgit\b|husky/i.test(text)) return null;
  if (/\bHUSKY(_SKIP_HOOKS)?\s*=\s*['"]?(0|1|false|true)\b/.test(text) && /\bgit\b/.test(text)) {
    return 'Git hook\'larını HUSKY ortam değişkeniyle atlamak engellendi. Hook hatasını düzelt; hook\'ları atlama.';
  }
  if (/core\.hookspath/i.test(text)) {
    return 'core.hooksPath ayarını değiştirmek ya da geçersiz kılmak engellendi; git hook\'ları atlanmamalı.';
  }
  for (const segment of text.split(/&&|\|\||;|\|/)) {
    const tokens = shellTokens(segment);
    const gitAt = tokens.findIndex((t) => /^git(\.exe)?$/i.test(path.posix.basename(t.replace(/\\/g, '/'))));
    if (gitAt === -1) continue;
    let i = gitAt + 1;
    // Skip global options such as -C <dir>, -c k=v, --git-dir=...
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C' || tokens[i] === '-c' || tokens[i] === '--git-dir' || tokens[i] === '--work-tree') i += 2;
      else i += 1;
    }
    const sub = tokens[i];
    if (!HOOKED_SUBCOMMANDS.has(sub)) continue;
    const args = tokens.slice(i + 1);
    if (args.some(isNoVerifyFlag) || (sub === 'commit' && args.some(isCommitShortNoVerify))) {
      return `git ${sub} için --no-verify engellendi. Hook'un neden başarısız olduğunu bul ve düzelt; gerçekten atlanması gerekiyorsa kullanıcı komutu kendisi çalıştırsın.`;
    }
  }
  return null;
}

// Lint, format and type-check settings: loosening these is the classic way to make a failing check "pass".
const PROTECTED_BASENAMES = new Set([
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintignore', '.prettierrc', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.json', '.prettierrc.yml',
  '.prettierrc.yaml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', '.prettierignore',
  'biome.json', 'biome.jsonc', '.biome.json', '.biome.jsonc', 'ruff.toml', '.ruff.toml', '.flake8', 'mypy.ini',
  '.mypy.ini', 'pyrightconfig.json', '.stylelintrc', '.stylelintrc.json', '.stylelintrc.yml', '.stylelintrc.yaml',
  '.stylelintrc.js', '.stylelintrc.cjs', 'stylelint.config.js', 'stylelint.config.cjs', 'stylelint.config.mjs',
  '.stylelintignore', '.shellcheckrc', '.editorconfig',
]);

export function isProtectedConfig(file) {
  return PROTECTED_BASENAMES.has(path.basename(String(file)).toLowerCase());
}

const SECRET_PATTERNS = [
  ['AWS erişim anahtarı', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['Anthropic API anahtarı', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API anahtarı', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ['Stripe gizli anahtarı', /\b(sk|rk)_live_[0-9A-Za-z]{20,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API anahtarı', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Özel anahtar', /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/],
];

const DSN = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^:\s/@]+):([^@\s/]+)@([^/\s:]+)/gi;
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|db|postgres|redis)$/i;
const PLACEHOLDER = /^(password|postgres|secret|pass|changeme|example|xxx+|\*+)$|[$<{]/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function jwtRole(payloadPart) {
  try {
    const json = Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

// Returns the kind of secret found, never the secret itself.
export function findSecret(text) {
  const s = String(text || '');
  for (const [label, re] of SECRET_PATTERNS) if (re.test(s)) return label;
  for (const m of s.matchAll(JWT)) {
    if (jwtRole(m[1]) === 'service_role') return 'Supabase service_role anahtarı (JWT)';
  }
  for (const m of s.matchAll(DSN)) {
    const [, , , password, host] = m;
    if (!LOCAL_HOSTS.test(host) && !PLACEHOLDER.test(password)) return 'şifre içeren bağlantı adresi (DSN)';
  }
  return null;
}

function isSecretsFile(file) {
  const base = path.basename(String(file)).toLowerCase();
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.env') || base === '.dev.vars';
}

function writtenText(toolName, input) {
  if (toolName === 'Write') return input.content;
  if (toolName === 'Edit') return input.new_string;
  if (toolName === 'MultiEdit' && Array.isArray(input.edits)) return input.edits.map((e) => e && e.new_string).join('\n');
  if (toolName === 'NotebookEdit') return input.new_source;
  return '';
}

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

export function checkFileWrite(toolName, input, cwd) {
  const file = input.file_path || input.notebook_path;
  if (!file) return null;
  const off = (name) => process.env[`LEGACIES_GUARD_${name}`] === 'off';
  if (!off('SECRETS') && !isSecretsFile(file)) {
    const kind = findSecret(writtenText(toolName, input));
    if (kind) {
      return deny(`Yazılan içerikte ${kind} var. Sırları koda, notlara ya da belgelere yazma: değeri bir ortam değişkeninden (örn. process.env.X) oku ve gerçek değeri .env.local gibi git'e girmeyen bir dosyaya koy.`);
    }
  }
  if (!off('CONFIG') && isProtectedConfig(file) && exists(path.resolve(cwd || '.', file))) {
    return ask(`${path.basename(file)} bir lint/format/tip denetimi ayarı. Bir kontrolü geçmek için kuralı gevşetmek yerine kodu düzeltmek doğru yol; değişiklik gerçekten gerekiyorsa kullanıcı onaylasın.`);
  }
  return null;
}
