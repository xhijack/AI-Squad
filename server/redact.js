// SPDX-License-Identifier: Apache-2.0
// Redaction for the Squad Log: secrets are always removed, personal data is masked by default.
// Every rule lives here so it can be tested on its own (test/redact.test.js has a false-positive list).

// a name is sensitive when one of its words (split on _ . - and camelCase) says so: DB_PASSWORD, apiKey,
// client-secret; GIT_AUTHOR_NAME or SHIPPING_FEE are not
const WORDS = new Set(['pass', 'password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'cookie', 'dsn', 'pin', 'credential', 'credentials', 'apikey', 'passphrase']);
const PAIRS = new Set(['api key', 'access key', 'private key', 'secret key', 'session key', 'client secret']);
export function sensitiveName(name) {
  const w = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_.-]+/).filter(Boolean);
  return w.some((x, i) => WORDS.has(x) || PAIRS.has(`${x} ${w[i + 1]}`));
}

// [name, pattern, replacement]. Order matters: whole private keys first, then prefixed tokens, then KEY=value.
export const SECRET_RULES = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  ['token', /\b(?:sk-ant-[\w-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|glpat-[\w-]{20,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|npm_[A-Za-z0-9]{36})\b/g, '[secret]'],
  ['jwt', /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g, '[secret]'],
  ['bearer', /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 [secret]'],
  ['url-credentials', /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, '$1:[secret]@'],
  // KEY=value, KEY: value, "key": "value" for sensitive names (env style or JSON)
  ['key-value', /\b([A-Za-z_][\w.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&]{4,})/g, (m, name, sep, val) => (sensitiveName(name) && val !== '[secret]' ? `${name}${sep}[secret]` : m)],
];

const EXT = /^(?:png|jpe?g|gif|svg|webp|ico|js|mjs|cjs|ts|tsx|css|html?|md|json|ya?ml|txt|py|lock)$/i;
export const PII_RULES = [
  ['email', /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+([A-Za-z]{2,24})\b/g, (m, _d, tld) => (EXT.test(tld) || /^(git|noreply|no-reply)@/i.test(m) || /@agents\.aisquad\.local$/i.test(m) ? m : '[email]')],
  ['iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, '[bank account]'],
  // account numbers only next to a word that says so: a bare long number is usually an id or a timestamp
  ['bank-account', /\b((?:bank\s+)?(?:account|acct|rekening|no\.?\s*rek(?:ening)?|rek\.?)(?:\s*(?:no\.?|number|nr\.?|#))?\s*[:=]?\s*)(\d[\d -]{6,22}\d)\b/gi, '$1[bank account]'],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g, '[national id]'],
  ['national-id', /(?<![\w.:-])[1-9]\d{15}(?![\w.:-])/g, '[national id]'],          // Indonesian NIK (16 digits)
  ['phone', /(?<![\w+.])(?:\+\d{1,3}[ -]?\(?\d{1,4}\)?(?:[ -]?\d{2,4}){2,4}|(?:\+62|62|0)8\d{2}[ -]?\d{3,4}[ -]?\d{3,5})(?![\w-])/g, '[phone]'],
];

export function redact(text, { pii = true } = {}) {
  if (text == null) return text;
  let s = String(text);
  for (const [, re, rep] of SECRET_RULES) s = s.replace(re, rep);
  if (pii) for (const [, re, rep] of PII_RULES) s = s.replace(re, rep);
  return s;
}

// .env files and other secret stores are never named with their contents; their path is kept
export const isSecretPath = (p) => /(^|[\\/])\.env(\.(?!example\b|sample\b|template\b)[\w.-]+)?$|(^|[\\/])(id_rsa|id_ed25519|.*\.pem|.*\.key|credentials\.json|\.netrc|\.npmrc|\.pypirc)$/i.test(String(p || ''));

// strings inside plain objects and arrays, recursively
export function redactDeep(v, opts) {
  if (typeof v === 'string') return redact(v, opts);
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, opts));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x, opts)]));
  return v;
}
