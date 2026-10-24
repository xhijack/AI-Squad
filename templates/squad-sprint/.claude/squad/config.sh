# ============================================================
#  Squad Sprint configuration (scaffolded by The AI Squad)
#  Read by the hooks and referenced by every agent.
# ============================================================

# Sprint the squad is working on. Change it with /sprint <N>.
SPRINT="1"

# Automated tests; the TaskCompleted hook runs them before a BUILD or BUG task may close.
# Empty ("") disables the test gate.
TEST_CMD="{{TEST_CMD}}"

# Starts the app (run ONCE by the lead, in the background). URLs QA uses.
START_CMD=""
APP_URL="http://localhost:3000"

# Team board folder (relative to the project root).
SQUAD_DOCS="docs/squad"

# How many times in a row TeammateIdle may hold back the same agent.
IDLE_MAX_NUDGE=3

# 1 = keep the hook input JSON in docs/squad/.hook-log/ (to inspect field names).
HOOK_DEBUG=0

# aisquad:team:start (maintained by The AI Squad from team.json)
LEAD_AGENT=""
DEV_AGENTS=""
QA_AGENTS=""
# aisquad:team:end
