// A small YAML subset for note headers: `key: value`, `key: [a, b]` and quoted strings.

export function parseFrontmatter(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text };
  const data = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) data[m[1]] = parseValue(m[2].trim());
  }
  let bodyStart = end + 4;
  if (text[bodyStart] === '\n') bodyStart += 1;
  return { data, body: text.slice(bodyStart) };
}

function parseValue(value) {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  return unquote(value);
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function quoteIfNeeded(value) {
  return /[:#,[\]"]|^\s|\s$|^$/.test(value) ? JSON.stringify(value) : value;
}

export function stringifyFrontmatter(data, body = '') {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    if (Array.isArray(value)) lines.push(`${key}: [${value.map((v) => quoteIfNeeded(String(v))).join(', ')}]`);
    else lines.push(`${key}: ${quoteIfNeeded(String(value))}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}${String(body).replace(/^\n+/, '')}`;
}

export function toList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}
