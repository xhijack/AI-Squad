// Minimal YAML subset for Markdown frontmatter: scalars, flow collections ([a, b], { k: v }),
// block maps and "- item" lists by indentation. Enough for Role Templates and agent files.

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(text) {
  const m = String(text ?? '').match(FM);
  if (!m) return { data: {}, body: String(text ?? '') };
  return { data: parseYaml(m[1]), body: String(text).slice(m[0].length) };
}

export function stringifyFrontmatter(data, body = '') {
  return `---\n${stringifyYaml(data)}---\n${body}`;
}

// ---------- parse ----------
export function parseYaml(src) {
  const lines = String(src).split(/\r?\n/)
    .map((raw) => ({ indent: raw.match(/^ */)[0].length, text: raw.trim() }))
    .filter((l) => l.text && !l.text.startsWith('#'));
  const [value] = parseBlock(lines, 0, lines.length ? lines[0].indent : 0);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseBlock(lines, i, indent) {
  if (i < lines.length && lines[i].text.startsWith('- ')) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      arr.push(parseScalarOrFlow(lines[i].text.slice(2)));
      i++;
    }
    return [arr, i];
  }
  const obj = {};
  while (i < lines.length && lines[i].indent === indent) {
    const t = lines[i].text;
    const k = t.match(/^("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
    if (!k) throw new Error(`Invalid YAML line: ${t}`);
    const key = unquote(k[1]);
    const rest = (k[2] ?? '').trim();
    i++;
    if (rest) obj[key] = parseScalarOrFlow(rest);
    else if (i < lines.length && lines[i].indent > indent) [obj[key], i] = parseBlock(lines, i, lines[i].indent);
    else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) [obj[key], i] = parseBlock(lines, i, indent);
    else obj[key] = null;
  }
  return [obj, i];
}

function unquote(s) {
  s = s.trim();
  if (s.startsWith('"')) return JSON.parse(s);
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function parseScalarOrFlow(s) {
  s = s.trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    const p = { s, i: 0 };
    const v = flowValue(p);
    skipWs(p);
    if (p.i !== s.length) throw new Error(`Unexpected text after flow value: ${s}`);
    return v;
  }
  return scalar(s.replace(/\s+#.*$/, (c) => (s.startsWith('"') || s.startsWith("'") ? c : '')));
}

function scalar(s) {
  s = s.trim();
  if (s.startsWith('"') || s.startsWith("'")) return unquote(s);
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const skipWs = (p) => { while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++; };

function flowValue(p) {
  skipWs(p);
  const c = p.s[p.i];
  if (c === '[') {
    p.i++; const arr = [];
    for (;;) {
      skipWs(p);
      if (p.s[p.i] === ']') { p.i++; return arr; }
      arr.push(flowValue(p));
      skipWs(p);
      if (p.s[p.i] === ',') p.i++;
      else if (p.s[p.i] !== ']') throw new Error(`Expected , or ] in ${p.s}`);
    }
  }
  if (c === '{') {
    p.i++; const obj = {};
    for (;;) {
      skipWs(p);
      if (p.s[p.i] === '}') { p.i++; return obj; }
      const key = flowToken(p, /[:,}]/);
      skipWs(p);
      if (p.s[p.i] !== ':') throw new Error(`Expected : in ${p.s}`);
      p.i++;
      obj[unquote(key)] = flowValue(p);
      skipWs(p);
      if (p.s[p.i] === ',') p.i++;
      else if (p.s[p.i] !== '}') throw new Error(`Expected , or } in ${p.s}`);
    }
  }
  return scalar(flowToken(p, /[,\]}]/));
}

function flowToken(p, stop) {
  skipWs(p);
  const q = p.s[p.i];
  if (q === '"' || q === "'") {
    const start = p.i++;
    while (p.i < p.s.length && p.s[p.i] !== q) p.i += p.s[p.i] === '\\' && q === '"' ? 2 : 1;
    p.i++;
    return p.s.slice(start, p.i);
  }
  const start = p.i;
  while (p.i < p.s.length && !stop.test(p.s[p.i])) p.i++;
  return p.s.slice(start, p.i).trim();
}

// ---------- stringify ----------
const PLAIN = /^[A-Za-z_][\w .\-/()*]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

export function fmtScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return PLAIN.test(s) && !RESERVED.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s);
}
function fmtFlow(v) {
  if (Array.isArray(v)) return `[${v.map(fmtFlow).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${fmtScalar(k)}: ${fmtFlow(x)}`).join(', ')} }`;
  return fmtScalar(v);
}

export function stringifyYaml(data, indent = '') {
  let out = '';
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length && Object.values(v).some((x) => x && typeof x === 'object')) {
      out += `${indent}${fmtScalar(k)}:\n${stringifyYaml(v, indent + '  ')}`;
    } else out += `${indent}${fmtScalar(k)}: ${fmtFlow(v)}\n`;
  }
  return out;
}
