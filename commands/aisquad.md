---
description: Open The AI Squad (your Claude Code teams as a 3D building), create a Floor, show the status, audit a Floor, or stop the server
argument-hint: "[new-floor | status | stop | uninstall | audit [floor] [--sprint N] | audit export]"
allowed-tools: Bash(node:*)
---

The AI Squad command was run as `aisquad $ARGUMENTS`. Its output:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/aisquad.js" $ARGUMENTS 2>&1`

Tell the user the result in a few short lines:

- No argument or `new-floor`: give the address from the output and say the PIN is in `~/.aisquad/pin` (`cat ~/.aisquad/pin`). With `new-floor` the New Floor wizard opens in the browser.
- `status`: show the Floors, agents, Attention and machine resources from the output and point out anything that needs the user.
- No argument: the server runs as a systemd user service (`aisquad.service`), a launchd agent on macOS, or a detached process, so it keeps running after this terminal or editor closes. Mention "Updated and restarted" when the output says so (the plugin was updated).
- `stop`: confirm the server stopped; agents keep running in tmux. `/aisquad` starts it again.
- `uninstall`: confirm the service was removed; `~/.aisquad` and the Floors stay.
- `audit [floor] [--sprint N]`: give the scores, the key numbers and the findings (most severe first) from the output, the audit's own cost, and the path of the report. Proposed changes are applied or dismissed by the owner in the Floor's Audit dialog; do not edit Role Templates or Blueprints yourself.
- `audit export`: give the path of the bundle and say it is anonymised and never uploaded; the owner decides whether to send it to Sopwer.

If the output shows an error, explain it and suggest checking `~/.aisquad/server.log`. Do not start agents or change any Floor yourself; the user does that in the browser.
