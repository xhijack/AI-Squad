import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep, isSecretPath, sensitiveName } from '../server/redact.js';

test('secrets are removed', () => {
  const cases = [
    ['ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop', /sk-ant/],
    ['token ghp_abcdefghijklmnopqrstuvwx1234 leaked', /ghp_/],
    ['github_pat_11ABCDEFG0123456789_abcdefghij', /github_pat_\w{5}/],
    ['slack xoxb-1234567890-abcdefghij', /xoxb-1/],
    ['aws AKIAIOSFODNN7EXAMPLE', /AKIA/],
    ['auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', /eyJ/],
    ['curl -H "Authorization: Bearer abcdef0123456789xyz"', /abcdef0123/],
    ['DATABASE_URL=postgres://app:hunter2pass@db:5432/app', /hunter2/],
    ['DB_PASSWORD=hunter2', /hunter2/],
    ['export STRIPE_SECRET_KEY="rk_live_51Habc"', /rk_live/],
    ['{"apiKey": "AIzaSyD-not-a-real-key-000000000000000"}', /AIza/],
    ['clientSecret: abc123xyz', /abc123xyz/],
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----', /b3BlbnNz/],
  ];
  for (const [input, leak] of cases) assert.doesNotMatch(redact(input), leak, input);
  assert.equal(redact('DB_PASSWORD=hunter2 next'), 'DB_PASSWORD=[secret] next');
});

test('personal data is masked by default and kept with pii off', () => {
  const cases = [
    ['mail budi.santoso@gmail.com now', 'mail [email] now'],
    ['call +62 812-3456-7890 today', 'call [phone] today'],
    ['wa 081234567890', 'wa [phone]'],
    ['US +1 415 555 2671', 'US [phone]'],
    ['NIK 3174012345678901', 'NIK [national id]'],
    ['SSN 123-45-6789', 'SSN [national id]'],
    ['rekening: 1234567890 BCA', 'rekening: [bank account] BCA'],
    ['account no. 0012-3456-789', 'account no. [bank account]'],
    ['IBAN DE89 3704 0044 0532 0130 00', 'IBAN [bank account]'],
  ];
  for (const [input, want] of cases) assert.equal(redact(input), want, input);
  assert.equal(redact('budi@gmail.com', { pii: false }), 'budi@gmail.com');
});

test('no false positives on ordinary engineering text', () => {
  const keep = [
    'commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39',
    'merged 1d0a6f6 into main at 2026-10-26T10:15:00+07:00',
    'ts 1761450000000 duration 1234 ms, port 8097, pid 120108',
    'uuid 7f1c2d3e-4b5a-6978-8a9b-0c1d2e3f4a5b',
    'react@18.3.1 three@0.160.0 @types/node',
    'git@github.com:xhijack/AI-Squad.git and noreply@anthropic.com',
    'icon@2x.png logo@3x.webp',
    'GIT_AUTHOR_NAME=Ramdani SHIPPING_FEE=12000 max_tokens: 4000 input_tokens=1200',
    'version 0.3.0, node >= 22, price 0.08123456789',
    'ramdani-frappe-developer@agents.aisquad.local',
    'see docs/squad/qa/M01.md line 42; 16 tests passed',
    'Pinned the lockfile; author: Quinn; tokens per SP 15000',
  ];
  for (const s of keep) assert.equal(redact(s), s, s);
});

test('names, paths and nested values', () => {
  assert.ok(sensitiveName('DB_PASSWORD') && sensitiveName('apiKey') && sensitiveName('client-secret') && sensitiveName('GITHUB_TOKEN'));
  assert.ok(!sensitiveName('GIT_AUTHOR_NAME') && !sensitiveName('SHIPPING') && !sensitiveName('max_tokens') && !sensitiveName('spinner'));
  for (const p of ['.env', '/x/.env.local', 'app/.env.production', 'id_rsa', 'certs/server.key', 'server.pem']) assert.ok(isSecretPath(p), p);
  for (const p of ['.env.example', 'src/env.js', 'docs/ENVIRONMENTS.md', 'keyboard.js']) assert.ok(!isSecretPath(p), p);
  assert.deepEqual(redactDeep({ a: ['TOKEN=abcd1234', 3], b: { c: 'x@y.com' } }), { a: ['TOKEN=[secret]', 3], b: { c: '[email]' } });
});
