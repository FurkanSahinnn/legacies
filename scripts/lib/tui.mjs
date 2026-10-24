// Zero-dependency terminal UI for the installer: colours, a gradient banner, spinner tasks and keyboard prompts.
// Everything degrades to plain text when stdout is not a terminal, NO_COLOR is set or --no-anim is passed.
import readline from 'node:readline';

const out = process.stdout;
export const interactive = Boolean(process.stdin.isTTY && out.isTTY);
const colorOn = Boolean(out.isTTY) && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb';
const unicode =
  process.platform !== 'win32' || Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ConEmuANSI || process.env.LEGACIES_UNICODE);
const trueColor =
  colorOn &&
  (/truecolor|24bit/i.test(process.env.COLORTERM || '') ||
    Boolean(process.env.WT_SESSION) ||
    (typeof out.hasColors === 'function' && out.hasColors(2 ** 24)));

let animate = interactive;
export function setAnimation(on) {
  animate = Boolean(on) && interactive;
}

const wrap = (open, close) => (s) => (colorOn ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export const sym = unicode
  ? { ok: '✔', fail: '✖', warn: '▲', info: '●', skip: '○', arrow: '❯', add: '+', remove: '−', keep: '=', on: '◉', off: '◯', diamond: '◆', tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' }
  : { ok: '+', fail: 'x', warn: '!', info: '*', skip: '-', arrow: '>', add: '+', remove: '-', keep: '=', on: '[x]', off: '[ ]', diamond: '#', tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
const FRAMES = unicode ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['|', '/', '-', '\\'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (s) => out.write(s);
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const visibleLength = (s) => [...String(s).replace(ANSI, '')].length;
const hideCursor = () => interactive && write('\x1b[?25l');
const showCursor = () => interactive && write('\x1b[?25h');
process.on('exit', showCursor);

// Violet → blue → cyan → green, sampled per character.
const STOPS = [
  [139, 92, 246],
  [59, 130, 246],
  [6, 182, 212],
  [16, 185, 129],
];
function mix(t) {
  const span = STOPS.length - 1;
  const seg = Math.min(span - 1, Math.floor(t * span));
  const local = t * span - seg;
  const [a, b] = [STOPS[seg], STOPS[seg + 1]];
  return a.map((v, i) => Math.round(v + (b[i] - v) * local));
}

// `shift` slides the colours along the text; the ping-pong keeps the animation free of a hard seam.
export function gradient(text, shift = 0) {
  if (!colorOn) return String(text);
  if (!trueColor) return c.cyan(text);
  const chars = [...String(text)];
  const n = Math.max(chars.length - 1, 1);
  return chars
    .map((ch, i) => {
      if (ch === ' ') return ch;
      let t = (i / n + shift) % 2;
      if (t > 1) t = 2 - t;
      const [r, g, b] = mix(t);
      return `\x1b[38;2;${r};${g};${b}m${ch}`;
    })
    .join('')
    .concat('\x1b[39m');
}

const LOGO = unicode
  ? [
      '██╗     ███████╗ ██████╗  █████╗  ██████╗██╗███████╗███████╗',
      '██║     ██╔════╝██╔════╝ ██╔══██╗██╔════╝██║██╔════╝██╔════╝',
      '██║     █████╗  ██║  ███╗███████║██║     ██║█████╗  ███████╗',
      '██║     ██╔══╝  ██║   ██║██╔══██║██║     ██║██╔══╝  ╚════██║',
      '███████╗███████╗╚██████╔╝██║  ██║╚██████╗██║███████╗███████║',
      '╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝╚══════╝╚══════╝',
    ]
  : [
      ' _                       _',
      '| | ___  __ _  __ _  ___(_) ___  ___',
      "| |/ _ \\/ _` |/ _` |/ __| |/ _ \\/ __|",
      '| |  __/ (_| | (_| | (__| |  __/\\__ \\',
      '|_|\\___|\\__, |\\__,_|\\___|_|\\___||___/',
      '        |___/',
    ];

export async function banner(subtitle) {
  const fits = (out.columns || 80) >= 66;
  const logo = fits ? LOGO : ['legacies'];
  write('\n');
  if (!animate) {
    for (const row of logo) write(`  ${gradient(row)}\n`);
  } else {
    hideCursor();
    for (const row of logo) {
      write(`  ${gradient(row)}\n`);
      await sleep(45);
    }
    // A short shimmer: the gradient slides across the logo a few times.
    for (let frame = 1; frame <= 14; frame += 1) {
      write(`\x1b[${logo.length}A`);
      for (const row of logo) write(`\r  ${gradient(row, frame / 7)}\x1b[K\n`);
      await sleep(40);
    }
    showCursor();
  }
  write(`  ${c.dim(subtitle)}\n`);
}

export function section(title) {
  write(`\n ${gradient(sym.diamond)} ${c.bold(title)}\n`);
}

const ICONS = {
  ok: () => c.green(sym.ok),
  fail: () => c.red(sym.fail),
  warn: () => c.yellow(sym.warn),
  info: () => c.cyan(sym.info),
  skip: () => c.gray(sym.skip),
  add: () => c.green(sym.add),
  remove: () => c.yellow(sym.remove),
  keep: () => c.gray(sym.keep),
};

export function item(kind, text, hint = '') {
  write(`   ${(ICONS[kind] || ICONS.info)()} ${text}${hint ? c.dim(` · ${hint}`) : ''}\n`);
}

export function detail(text) {
  write(`     ${c.dim(text)}\n`);
}

// A shell command to copy: one unwrapped row with no border, so a paste runs exactly what is shown.
export function command(text) {
  write(`     ${c.cyan(text)}\n`);
}

// Runs fn while a spinner turns. fn may return a string (shown as detail) or { skipped: reason }.
export async function task(title, fn, { minMs = 320 } = {}) {
  const start = Date.now();
  let frame = 0;
  let timer = null;
  if (animate) {
    hideCursor();
    timer = setInterval(() => {
      frame = (frame + 1) % FRAMES.length;
      write(`\r   ${gradient(FRAMES[frame], frame / FRAMES.length)} ${title}\x1b[K`);
    }, 80);
  }
  let result;
  let error = null;
  try {
    result = await fn();
  } catch (err) {
    error = err;
  }
  if (animate) {
    const elapsed = Date.now() - start;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    clearInterval(timer);
    write('\r\x1b[K');
    showCursor();
  }
  const secs = c.dim(`${((Date.now() - start) / 1000).toFixed(1)} sn`);
  if (error) {
    item('fail', title);
    detail(String(error.message || error).slice(0, 400));
  } else if (result && typeof result === 'object' && result.skipped) {
    item('skip', title, result.skipped);
  } else {
    write(`   ${c.green(sym.ok)} ${title}${typeof result === 'string' && result ? c.dim(` · ${result}`) : ''} ${secs}\n`);
  }
  return { ok: !error, error, result };
}

// Breaks a plain-text line at spaces so it fits `room`. Continuation rows hang under the text that follows
// the indent or a list marker such as "1. "; a single word longer than a row is cut.
function wrapLine(line, room) {
  if (visibleLength(line) <= room) return [line];
  if (!line.trim()) return [''];
  const lead = /^\s*(?:\d+\.\s+|[-•]\s+)?/.exec(line)[0];
  // At most half a row, so cutting a long word always makes progress.
  const hang = ' '.repeat(Math.min(visibleLength(lead), Math.floor(room / 2)));
  const rows = [];
  let current = lead;
  let rowHasWord = false;
  for (const word of line.slice(lead.length).split(/\s+/).filter(Boolean)) {
    const next = rowHasWord ? `${current} ${word}` : `${current}${word}`;
    if (visibleLength(next) <= room) {
      current = next;
    } else {
      if (rowHasWord) rows.push(current);
      current = rowHasWord ? `${hang}${word}` : next;
      while (visibleLength(current) > room) {
        const chars = [...current];
        rows.push(chars.slice(0, room).join(''));
        current = `${hang}${chars.slice(room).join('')}`;
      }
    }
    rowHasWord = true;
  }
  rows.push(current);
  return rows;
}

// Every row is inner width + 2 characters wide, so the right border lines up; long lines wrap.
export function box(title, lines, { tone = 'ok' } = {}) {
  const color = tone === 'fail' ? c.red : tone === 'warn' ? c.yellow : (s) => gradient(s);
  const cap = Math.max((out.columns || 80) - 6, 40);
  const inner = Math.min(Math.max(visibleLength(title) + 5, ...lines.map((l) => visibleLength(l) + 3)), cap);
  const rows = lines.flatMap((line) => wrapLine(line, inner - 2));
  write(`\n  ${color(`${sym.tl}${sym.h} `)}${c.bold(title)} ${color(`${sym.h.repeat(Math.max(inner - visibleLength(title) - 3, 0))}${sym.tr}`)}\n`);
  for (const row of rows) {
    const pad = Math.max(inner - visibleLength(row) - 1, 0);
    write(`  ${color(sym.v)} ${row}${' '.repeat(pad)}${color(sym.v)}\n`);
  }
  write(`  ${color(`${sym.bl}${sym.h.repeat(inner)}${sym.br}`)}\n`);
}

// Without a keyboard the default is taken, but the decision still shows in the log.
function answered(question, answer) {
  write(`  ${c.green(sym.ok)} ${c.bold(question)} ${c.cyan(answer)}\n`);
}

function cancelled() {
  showCursor();
  write(`\n   ${c.yellow(sym.warn)} İptal edildi; hiçbir şey değiştirilmedi.\n`);
  process.exit(130);
}

// Resolves when handler(str, key) returns something other than undefined.
function onKeys(handler) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const listener = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        stdin.setRawMode(wasRaw);
        cancelled();
      }
      const value = handler(str, key);
      if (value === undefined) return;
      stdin.off('keypress', listener);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      resolve(value);
    };
    stdin.on('keypress', listener);
  });
}

const fit = (text, room) => (visibleLength(text) <= room ? text : `${[...text].slice(0, Math.max(room - 1, 1)).join('')}…`);

function menu(question, help, rows) {
  const cols = (out.columns || 80) - 2;
  return [`  ${c.cyan('?')} ${c.bold(question)} ${c.dim(help)}`, ...rows.map((r) => fit(r, cols))];
}

export async function select(question, options, { initial = 0 } = {}) {
  const usable = options.filter((o) => !o.disabled);
  if (!interactive) {
    const pick = usable[initial] || usable[0];
    answered(question, pick.label);
    return pick.value;
  }
  let index = Math.min(initial, usable.length - 1);
  let drawn = 0;
  const render = () => {
    if (drawn) write(`\x1b[${drawn}A\x1b[0J`);
    const rows = menu(
      question,
      '(↑↓ seç, Enter onayla)',
      usable.map((o, i) => `    ${i === index ? c.cyan(sym.arrow) : ' '} ${i === index ? c.bold(o.label) : o.label}${o.hint ? c.dim(` · ${o.hint}`) : ''}`),
    );
    write(`${rows.join('\n')}\n`);
    drawn = rows.length;
  };
  hideCursor();
  render();
  const value = await onKeys((str, key) => {
    if (key.name === 'up' || str === 'k') {
      index = (index - 1 + usable.length) % usable.length;
      render();
    } else if (key.name === 'down' || str === 'j') {
      index = (index + 1) % usable.length;
      render();
    } else if (key.name === 'return') {
      return usable[index].value;
    }
    return undefined;
  });
  write(`\x1b[${drawn}A\x1b[0J`);
  write(`  ${c.green(sym.ok)} ${c.bold(question)} ${c.cyan(usable.find((o) => o.value === value).label)}\n`);
  showCursor();
  return value;
}

const CONFIRM_LABEL = '[ Onaylıyorum ]';
const PAGE_STEP = 10;

// Keys of the checkbox lists. Enter (or Space) turns the option under the cursor on or off. The confirm
// row under the last option (index === values.length) finishes the list, after "Emin misiniz?". The
// arrows wrap, so ↑ on the first option reaches the confirm row.
export function checkboxKey(state, str, key) {
  const rows = state.values.length + 1;
  const onConfirm = state.index === state.values.length;
  let index = state.index;
  if (key.name === 'up' || str === 'k') index = (index - 1 + rows) % rows;
  else if (key.name === 'down' || str === 'j') index = (index + 1) % rows;
  else if (key.name === 'pageup') index = Math.max(index - PAGE_STEP, 0);
  else if (key.name === 'pagedown') index = Math.min(index + PAGE_STEP, rows - 1);
  else if (key.name === 'return' && onConfirm) return { ...state, ask: true };
  else if ((key.name === 'return' || key.name === 'space') && !onConfirm) {
    const chosen = new Set(state.chosen);
    const value = state.values[index];
    if (chosen.has(value)) chosen.delete(value);
    else chosen.add(value);
    return { ...state, chosen, ask: false };
  }
  return { ...state, index, ask: false };
}

// "Hayır" keeps the choices for more editing; either way the question's line is cleared, so the list is
// redrawn (or replaced by its answer) in place.
async function sureToFinish() {
  const sure = await confirm('Emin misiniz?');
  write('\x1b[1A\x1b[0J');
  return sure;
}

export async function multiselect(question, options) {
  const usable = options.filter((o) => !o.disabled);
  let state = { index: 0, values: usable.map((o) => o.value), chosen: new Set(usable.filter((o) => o.checked).map((o) => o.value)), ask: false };
  if (!interactive || usable.length === 0) {
    const labels = usable.filter((o) => state.chosen.has(o.value)).map((o) => o.label);
    answered(question, labels.length ? labels.join(', ') : 'hiçbiri');
    return [...state.chosen];
  }
  let drawn = 0;
  const render = () => {
    if (drawn) write(`\x1b[${drawn}A\x1b[0J`);
    const rows = menu(question, '(↑↓ gez · Enter: aç/kapat · bitince en alttaki Onaylıyorum)', [
      ...usable.map((o, i) => optionRow(o, i === state.index, state.chosen)),
      confirmRow(state.index === usable.length),
    ]);
    write(`${rows.join('\n')}\n`);
    drawn = rows.length;
  };
  hideCursor();
  do {
    render();
    await onKeys((str, key) => {
      state = checkboxKey(state, str, key);
      if (state.ask) return true;
      render();
      return undefined;
    });
  } while (!(await sureToFinish()));
  write(`\x1b[${drawn}A\x1b[0J`);
  const labels = usable.filter((o) => state.chosen.has(o.value)).map((o) => o.label);
  write(`  ${c.green(sym.ok)} ${c.bold(question)} ${c.cyan(labels.length ? labels.join(', ') : 'hiçbiri')}\n`);
  showCursor();
  return [...state.chosen];
}

function optionRow(o, active, chosen) {
  const mark = chosen.has(o.value) ? c.green(sym.on) : c.gray(sym.off);
  return `    ${active ? c.cyan(sym.arrow) : ' '} ${mark} ${active ? c.bold(o.label) : o.label}${o.hint ? c.dim(` · ${o.hint}`) : ''}`;
}

function confirmRow(active) {
  return `    ${active ? c.cyan(sym.arrow) : ' '} ${active ? c.bold(c.green(CONFIRM_LABEL)) : c.green(CONFIRM_LABEL)}`;
}

// The group under the cursor turned on, or off when all of it already is.
function toggleGroup(state, options) {
  const group = options.filter((o) => o.group === options[state.index].group);
  const all = group.every((o) => state.chosen.has(o.value));
  const chosen = new Set(state.chosen);
  for (const o of group) {
    if (all) chosen.delete(o.value);
    else chosen.add(o.value);
  }
  return { ...state, chosen };
}

// A long checkbox list in titled groups: the window scrolls with the cursor, titles cannot be selected,
// and `a` turns the whole group under the cursor on or off. The confirm row closes the list.
export async function checklist(question, groups) {
  const rows = groups.flatMap((g) => [{ title: g.title }, ...g.options.filter((o) => !o.disabled).map((o) => ({ ...o, group: g.title }))]);
  const options = rows.filter((r) => !r.title);
  let state = { index: 0, values: options.map((o) => o.value), chosen: new Set(options.filter((o) => o.checked).map((o) => o.value)), ask: false };
  if (!interactive || options.length === 0) {
    answered(question, `${state.chosen.size} seçili`);
    return [...state.chosen];
  }
  const lines = [...rows, { confirm: true }];
  let top = 0;
  let drawn = 0;
  const render = () => {
    if (drawn) write(`\x1b[${drawn}A\x1b[0J`);
    const height = Math.min(Math.max((out.rows || 24) - 4, 6), lines.length);
    const at = state.index < options.length ? lines.indexOf(options[state.index]) : lines.length - 1;
    // Keep the group title in view when the cursor sits on the group's first option.
    const first = lines[at - 1]?.title ? at - 1 : at;
    if (first < top) top = first;
    if (at >= top + height) top = at - height + 1;
    const visible = lines.slice(top, top + height).map((r) => {
      if (r.title) return `   ${c.bold(c.cyan(r.title))}`;
      if (r.confirm) return confirmRow(state.index === options.length);
      return optionRow(r, r === options[state.index], state.chosen);
    });
    const position = lines.length > height ? ` ${top + 1}-${top + visible.length}/${lines.length}` : '';
    const screen = menu(question, `(↑↓ gez · Enter: aç/kapat · a: grubu aç/kapat · bitince en alttaki Onaylıyorum${position})`, visible);
    write(`${screen.join('\n')}\n`);
    drawn = screen.length;
  };
  hideCursor();
  do {
    render();
    await onKeys((str, key) => {
      if (str === 'a' && state.index < options.length) state = toggleGroup(state, options);
      else {
        state = checkboxKey(state, str, key);
        if (state.ask) return true;
      }
      render();
      return undefined;
    });
  } while (!(await sureToFinish()));
  write(`\x1b[${drawn}A\x1b[0J`);
  write(`  ${c.green(sym.ok)} ${c.bold(question)} ${c.cyan(`${state.chosen.size} seçili`)}\n`);
  showCursor();
  return [...state.chosen];
}

export async function confirm(question, { initial = true } = {}) {
  if (!interactive) {
    answered(question, initial ? 'evet' : 'hayır');
    return initial;
  }
  write(`  ${c.cyan('?')} ${c.bold(question)} ${c.dim(initial ? '(E/h)' : '(e/H)')} `);
  const value = await onKeys((str, key) => {
    if (key.name === 'return') return initial;
    if (/^[eEyY]$/.test(str || '')) return true;
    if (/^[hHnN]$/.test(str || '')) return false;
    return undefined;
  });
  write(`${value ? c.green('evet') : c.yellow('hayır')}\n`);
  return value;
}
