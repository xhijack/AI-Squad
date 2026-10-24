#!/usr/bin/env bash
# ------------------------------------------------------------------
#  Squad Sprint quality gate when a task is about to be completed.
#  Exit 2 = refuse (the task stays open, stderr goes to the agent). Exit 0 = pass.
#
#  Task names (words 1 and 2 are read here):
#    BUILD M01 Login
#    QA M01 Login
#    BUG M01-B01 Save button does nothing
# ------------------------------------------------------------------
set -uo pipefail

INPUT="$(cat)"
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# shellcheck disable=SC1091
source "$ROOT/.claude/squad/config.sh" 2>/dev/null || true
SQUAD_DOCS="${SQUAD_DOCS:-docs/squad}"
DIR="$ROOT/$SQUAD_DOCS"

if [ "${HOOK_DEBUG:-0}" = "1" ]; then
  mkdir -p "$DIR/.hook-log"
  printf '%s\n' "$INPUT" > "$DIR/.hook-log/task-completed-last.json"
fi

# Without jq the input cannot be read: the gate is skipped.
command -v jq >/dev/null 2>&1 || exit 0

# Field names are not fully documented: try a few, then the first string starting with BUILD/QA/BUG.
SUBJECT="$(jq -r '.task_subject // .task.subject // .subject // .task_title // .task.title // empty' <<<"$INPUT" 2>/dev/null)"
if [ -z "$SUBJECT" ]; then
  SUBJECT="$(jq -r '[.. | strings | select(test("^\\s*\\[?(BUILD|QA|BUG)\\]?\\s+M[0-9]"; "i"))] | first // empty' <<<"$INPUT" 2>/dev/null)"
fi
[ -z "$SUBJECT" ] && exit 0

# "[BUILD] M01: Login" -> "BUILD M01 Login"
CLEAN="$(tr -d '[]:' <<<"$SUBJECT")"
KIND="$(awk '{print toupper($1)}' <<<"$CLEAN")"
ID="$(awk '{print toupper($2)}' <<<"$CLEAN")"

reject() { printf '%s\n' "$1" >&2; exit 2; }

run_tests() {
  [ -z "${TEST_CMD:-}" ] && return 0
  local out
  if ! out="$(cd "$ROOT" && bash -c "$TEST_CMD" 2>&1)"; then
    reject "Quality gate: tests FAILED for $ID. Fix them before completing the task.
Command: $TEST_CMD
--- last 40 lines ---
$(tail -n 40 <<<"$out")"
  fi
}

case "$KIND" in
  BUILD)
    [ -f "$DIR/handoff/$ID.md" ] || reject "Quality gate: no handoff note yet.
Write $SQUAD_DOCS/handoff/$ID.md (template: $SQUAD_DOCS/templates/handoff.md),
then complete the task again and message QA."
    run_tests
    ;;
  BUG)
    BUGFILE="$DIR/bugs/$ID.md"
    [ -f "$BUGFILE" ] || reject "Quality gate: bug file $SQUAD_DOCS/bugs/$ID.md not found."
    grep -qiE '^STATUS:[[:space:]]*FIXED' "$BUGFILE" || reject "Quality gate: set 'STATUS: FIXED' in $SQUAD_DOCS/bugs/$ID.md
and fill in the 'Fix' section, then ask QA to retest."
    run_tests
    ;;
  QA)
    REPORT="$DIR/qa/$ID.md"
    [ -f "$REPORT" ] || reject "Quality gate: no QA report at $SQUAD_DOCS/qa/$ID.md yet."
    grep -qiE '^STATUS:[[:space:]]*PASS' "$REPORT" || reject "Quality gate: QA report $ID is not 'STATUS: PASS'.
While Blocker or Major bugs are open, keep the QA task open: file BUG tasks and wait for the fixes."
    OPEN_BUGS=""
    for b in "$DIR"/bugs/"$ID"-*.md; do
      [ -e "$b" ] || continue
      if grep -qiE '^STATUS:[[:space:]]*(OPEN|FIXED)' "$b"; then
        OPEN_BUGS="$OPEN_BUGS $(basename "$b" .md)"
      fi
    done
    [ -z "$OPEN_BUGS" ] || reject "Quality gate: bugs for $ID are not VERIFIED or DEFERRED yet:$OPEN_BUGS
Retest until they are VERIFIED (or DEFERRED with the lead's approval)."
    ;;
esac

exit 0
