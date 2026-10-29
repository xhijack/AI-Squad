#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The AI Squad, one command on a new machine (Linux, macOS, WSL):
#   curl -fsSL https://raw.githubusercontent.com/xhijack/AI-Squad/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --blueprint software-house --name "First squad"
# It checks Node.js 22+, git, tmux and Claude Code (and says how to install what is missing), clones or updates
# The AI Squad into ~/.aisquad-app, links `aisquad` into ~/.local/bin and runs `aisquad quickstart` (server, PIN,
# browser, and a first squad when --blueprint is given). Nothing is installed with sudo.
# Environment: AISQUAD_DIR (where the app goes), AISQUAD_REPO, AISQUAD_BRANCH (default main).
set -euo pipefail

DIR="${AISQUAD_DIR:-$HOME/.aisquad-app}"
REPO="${AISQUAD_REPO:-https://github.com/xhijack/AI-Squad.git}"
BRANCH="${AISQUAD_BRANCH:-main}"
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
no() { printf '  \033[31m✗\033[0m %s\n' "$1"; MISSING=1; }
MISSING=0

echo "The AI Squad: checking this machine"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then ok "Node.js $(node -v)"
else no "Node.js 22 or newer: https://nodejs.org/en/download (or: nvm install 22)"; fi
if command -v git >/dev/null 2>&1; then ok "git"; else no "git: sudo apt install git (Linux), xcode-select --install (macOS)"; fi
if command -v tmux >/dev/null 2>&1; then ok "tmux"; else no "tmux: sudo apt install tmux (Linux), brew install tmux (macOS)"; fi
if command -v claude >/dev/null 2>&1; then ok "Claude Code $(claude --version 2>/dev/null | head -1)"
else no "Claude Code: curl -fsSL https://claude.ai/install.sh | bash   (then run claude once to sign in)"; fi
if [ "$MISSING" = 1 ]; then echo "Install what is missing, then run this command again."; exit 1; fi

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR"
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" merge -q --ff-only "origin/$BRANCH"
else
  echo "Downloading The AI Squad into $DIR"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
chmod +x "$DIR/bin/aisquad.js"
mkdir -p "$HOME/.local/bin"
ln -sf "$DIR/bin/aisquad.js" "$HOME/.local/bin/aisquad"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "  Add ~/.local/bin to your PATH to type 'aisquad' anywhere (the installer used it directly).";; esac
exec node "$DIR/bin/aisquad.js" quickstart "$@"
