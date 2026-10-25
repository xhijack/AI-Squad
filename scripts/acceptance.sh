#!/usr/bin/env bash
# Visual acceptance screenshots (Phase 2.1): seeds the playground, starts the dev server with the fake Claude Code,
# puts agents in every state (working via hook events, idle via fake sessions, waiting, stopped) and captures
# scripts/shots/acceptance.json into playground/reference/after-*.png. One headless Chrome at a time.
cd "$(dirname "$0")/.." || exit 1
node scripts/seed-playground.js >/dev/null
CLAUDE_BIN=$PWD/test/fixtures/fake-claude.cjs AISQUAD_NO_SYSTEMD=1 scripts/dev.sh restart >/dev/null
sleep 1
U=http://127.0.0.1:8097; H=(-H 'x-aisquad-pin: 123456' -H 'content-type: application/json')
# idle: fake Claude Code sessions (their trust dialog is answered through Attention)
for a in sopwer-hr/agus-frappe-developer sopwer-hr/lina-sprint-lead acme-coffee-shop/dewi-ui-ux-designer; do
  curl -s "${H[@]}" -X POST "$U/api/floors/${a%%/*}/agents/${a#*/}/start" -d '{}' >/dev/null
done
sleep 5
for id in $(curl -s $U/api/building | node -e 'const b=JSON.parse(require("fs").readFileSync(0));console.log(b.attention.filter((a)=>a.answerable&&/trust/i.test(a.text)).map((a)=>a.id).join(" "))'); do
  curl -s "${H[@]}" -X POST "$U/api/attention/$id/answer" -d '{"option":1}' >/dev/null
done
# working: live hook events, as Claude Code's plugin hooks would send them
working() { curl -s "${H[@]}" -X POST "$U/api/events" -d "{\"event\":\"PreToolUse\",\"agent\":\"$1\",\"payload\":{\"tool_name\":\"$2\",\"tool_input\":$3}}" >/dev/null; }
working sopwer-hr/ramdani-frappe-developer Edit '{"file_path":"apps/sopwer_hr/report/leave_encashment.py"}'
working sopwer-hr/dian-frappe-developer Bash '{"command":"bench run-tests --app sopwer_hr","description":"Run the leave tests"}'
working acme-coffee-shop/budi-fullstack-developer Edit '{"file_path":"src/catalogue.css"}'
sleep 2
node scripts/shot.js scripts/shots/acceptance.json
