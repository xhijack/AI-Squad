---
description: Open The AI Squad (your Claude Code teams as a 3D building), create a Floor, or show the status
argument-hint: "[new-floor | status | stop]"
allowed-tools: Bash(node:*)
---

The AI Squad command was run as `aisquad $ARGUMENTS`. Its output:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/aisquad.js" $ARGUMENTS 2>&1`

Tell the user the result in a few short lines:

- No argument or `new-floor`: give the address from the output and say the PIN is in `~/.aisquad/pin` (`cat ~/.aisquad/pin`). With `new-floor` the New Floor wizard opens in the browser.
- `status`: show the Floors, agents, Attention and machine resources from the output and point out anything that needs the user.
- `stop`: confirm the server stopped; agents keep running in tmux.

If the output shows an error, explain it and suggest checking `~/.aisquad/server.log`. Do not start agents or change any Floor yourself; the user does that in the browser.
