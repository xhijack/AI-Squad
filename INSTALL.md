# Installing The AI Squad

## Requirements

- Node.js 22 or newer
- Claude Code (`claude`), logged in
- tmux (`sudo apt install tmux`, or `brew install tmux` on macOS)
- Access to `xhijack/AI-Squad` on GitHub (an SSH key if the repository is private)

## Option 1: Claude Code plugin (recommended)

Open `claude` in a terminal and type:

```
/plugin marketplace add xhijack/AI-Squad
/plugin install aisquad@aisquad
/aisquad
```

- If the first line fails because the repository is private, use the SSH address:
  `/plugin marketplace add git@github.com:xhijack/AI-Squad.git`
- `/aisquad` starts the server as a service and opens `http://localhost:8097`.
- The PIN for changes: `cat ~/.aisquad/pin`
- Keep the server running after you log out (Linux): `loginctl enable-linger $USER`

### Update

```
/plugin marketplace update aisquad
/plugin update aisquad@aisquad
```

Then **quit Claude Code and open it again** (Claude Code says "Restart to apply changes"; until
then `/aisquad` still runs the old version), and run:

```
/aisquad
```

It prints `Updated and restarted: The AI Squad <version>`. Check the version with
`/aisquad status` (plugin and server must match) or the (i) button in the dock. Reload the
browser tab afterwards.

## Option 2: git clone (to work on the code)

```bash
git clone git@github.com:xhijack/AI-Squad.git
cd AI-Squad
node bin/aisquad.js        # or: claude --plugin-dir .
```

## Running on a server, viewing from a laptop

The server listens on `127.0.0.1` by default. Two ways to reach it:

- **SSH tunnel (safer)**: on the laptop run `ssh -L 8097:localhost:8097 user@server`, then open
  `http://localhost:8097`.
- **Open it to the network**: `node bin/aisquad.js --host 0.0.0.0`, then open
  `http://<server-ip>:8097`. Every request then needs the PIN; the browser asks for it once.

## First steps after installing

1. **Floor 1**: Claude Code sessions already running on the machine show up as independent agents.
2. **Lobby → Set up Squad**: describe what you want to build (for example "a software house that
   builds a restaurant POS"), check the recommended team, choose a new folder, Create. The squad
   appears on Floor 2.
3. **Start the lead**: the PM refuses to start a sprint until PRD, Tech, Design and Environments
   are approved, and interviews you for them. Its questions appear in Attention.
4. Click a character for the first person view, click a monitor for the screen view, and try
   Performance, the Server meter and Voice in the dock.

## Troubleshooting

```
/aisquad status                       # server, service, Floors, agents, resources
journalctl --user -u aisquad -n 50    # service log (Linux)
```

## Uninstall

```
/aisquad uninstall
/plugin uninstall aisquad@aisquad
/plugin marketplace remove aisquad
```

Floors and their repositories are not touched. Delete `~/.aisquad` to remove the machine-local
data (Building registry, Role Template library, PIN, logs).
