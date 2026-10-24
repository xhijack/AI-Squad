#!/usr/bin/env bash
# ------------------------------------------------------------------
#  Squad Sprint: keep a teammate from going idle while work is waiting.
#  The files in docs/squad are the source of truth (task status can lag).
#
#  QA agents (QA_AGENTS in config.sh): held back while a handed-off module has no QA report
#    or a FIXED bug waits for retest.
#  Other teammates (developers): held back while a bug with OWNER: <their id> is OPEN.
#  After IDLE_MAX_NUDGE nudges in a row the agent is released (no loops).
# ------------------------------------------------------------------
set -uo pipefail

INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# shellcheck disable=SC1091
source "$ROOT/.claude/squad/config.sh" 2>/dev/null || true
SQUAD_DOCS="${SQUAD_DOCS:-docs/squad}"
DIR="$ROOT/$SQUAD_DOCS"
MAX="${IDLE_MAX_NUDGE:-3}"

if [ "${HOOK_DEBUG:-0}" = "1" ]; then
  mkdir -p "$DIR/.hook-log"
  printf '%s\n' "$INPUT" > "$DIR/.hook-log/teammate-idle-last.json"
fi

command -v jq >/dev/null 2>&1 || exit 0

NAME="$(jq -r '.teammate_name // .teammate.name // .agent_name // .name // .agent_type // empty' <<<"$INPUT" 2>/dev/null)"
[ -z "$NAME" ] && exit 0
NAME_LC="$(tr '[:upper:]' '[:lower:]' <<<"$NAME")"

COUNTER="$DIR/.idle-$NAME_LC"
MSG=""

if [[ " ${QA_AGENTS:-} " == *" $NAME_LC "* ]] || [[ -z "${QA_AGENTS:-}" && "$NAME_LC" == qa* ]]; then
  WAITING=""
  for h in "$DIR"/handoff/*.md; do
    [ -e "$h" ] || continue
    id="$(basename "$h" .md)"
    [ -f "$DIR/qa/$id.md" ] || WAITING="$WAITING $id"
  done
  RETEST=""
  for b in "$DIR"/bugs/*.md; do
    [ -e "$b" ] || continue
    grep -qiE '^STATUS:[[:space:]]*FIXED' "$b" && RETEST="$RETEST $(basename "$b" .md)"
  done
  [ -n "$WAITING" ] && MSG="Handed-off modules without a QA report:$WAITING. "
  [ -n "$RETEST" ] && MSG="${MSG}FIXED bugs waiting for retest:$RETEST. "
elif [ "$NAME_LC" != "${LEAD_AGENT:-}" ]; then
  MINE=""
  for b in "$DIR"/bugs/*.md; do
    [ -e "$b" ] || continue
    if grep -qiE "^OWNER:[[:space:]]*$NAME_LC([[:space:]]|$)" "$b" && grep -qiE '^STATUS:[[:space:]]*OPEN' "$b"; then
      MINE="$MINE $(basename "$b" .md)"
    fi
  done
  [ -n "$MINE" ] && MSG="You still have OPEN bugs:$MINE. Fix them first (they come before new modules). "
fi

if [ -z "$MSG" ]; then
  rm -f "$COUNTER"
  exit 0
fi

N=0
[ -f "$COUNTER" ] && N="$(cat "$COUNTER" 2>/dev/null || echo 0)"
N=$((N + 1))
if [ "$N" -gt "$MAX" ]; then
  rm -f "$COUNTER"
  exit 0   # release to avoid a loop; the lead follows up
fi
echo "$N" > "$COUNTER"

printf 'Do not go idle yet. %sCheck %s and continue.\n' "$MSG" "$SQUAD_DOCS" >&2
exit 2
