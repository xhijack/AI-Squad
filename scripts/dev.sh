#!/usr/bin/env bash
# Start/stop the dev server against the playground Building. Usage: scripts/dev.sh start|stop|restart
# Port 8097, or AISQUAD_PORT (use another port, e.g. 8096, while the real aisquad.service runs on 8097).
cd "$(dirname "$0")/.." || exit 1
PORT="${AISQUAD_PORT:-8097}"
PIDF=playground/server.pid
stop() { [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; }
start() {
  mkdir -p playground
  AISQUAD_HOME=playground/home CLAUDE_HOME=playground/claude AISQUAD_TMUX_SOCKET=aisquad-dev AISQUAD_PORT="$PORT" \
    nohup node server/index.js --port "$PORT" > playground/server.log 2>&1 &
  echo $! > "$PIDF"; sleep 0.8; cat playground/server.log
}
case "$1" in start) start ;; stop) stop ;; restart) stop; sleep 0.3; start ;; *) echo "usage: $0 start|stop|restart" ;; esac
