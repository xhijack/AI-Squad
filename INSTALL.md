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

## Online (VPS or this machine)

The AI Squad controls agents that have a shell on the machine, so put nothing in front of it that you would not put in
front of SSH. In every case below **the server stays on `127.0.0.1:8097`** and something else takes the internet's
requests. The same code runs on this machine and on a VPS: only the settings differ.

**Public mode.** Behind a proxy every request reaches the server from `127.0.0.1`, so the server cannot tell the
internet from you. Public mode closes that: every route, reads and static files included, needs a signed-in person;
only the sign-in page and its files load before. It turns on with `node server/index.js --public`, with
`"public": true` in `~/.aisquad/building.json` → `prefs`, or by itself on the first request that carries
`X-Forwarded-For`, `Forwarded` or `CF-Connecting-IP`; then it stays on until the server restarts. Set `prefs.public`
so it is on before the first request.

**Signing in.** The browser sends the PIN once and gets a session cookie (`HttpOnly`, `SameSite=Strict`, `Secure`
over HTTPS); the PIN is never kept in the browser. A session ends after 12 hours without use, after 7 days at most,
with Menu → **Sign out**, or with Menu → **Sign out everywhere** (Owner). Five wrong PINs from one address within 15
minutes make that address wait 5 minutes, then 10, 20, 40, at most an hour. **Twenty wrong PINs within a day lock PIN
sign-in for everyone** until the Owner runs `/aisquad unlock` (or `node bin/aisquad.js unlock`) on the machine, or
sends `/unlock` in the Owner's paired Telegram chat (the bot runs while notifications are on). Every lockout is sent
to the Owner's Telegram. Sessions already signed in, agent hooks and the command line on the machine keep working.
With a paired Owner chat, an Owner session in public mode also types a **6-digit code sent to Telegram** before
settings, secrets, people, merges or Owner-only Spaces (`prefs.secondFactor: false` turns that off).

Settings, all in `~/.aisquad/building.json` under `"prefs"`:

```json
{
  "prefs": {
    "public": true,
    "publicUrl": "https://squad.example.com",
    "trustProxy": 1,
    "cfAccess": { "teamDomain": "yourteam.cloudflareaccess.com", "aud": "<Application Audience (AUD) tag>" }
  }
}
```

- `publicUrl`: the address people open. Changes (POST, PUT, PATCH, DELETE) are refused unless the browser's
  `Origin` (or `Referer`) is that address or the host the request was sent to.
- `trustProxy`: how many proxies stand in front (default 1 in public mode). The client address for the limits and
  the Log is read that many hops back in `X-Forwarded-For`. Forwarding headers are only believed from `127.0.0.1`:
  run the proxy on the same machine.
- `cfAccess`: only with Cloudflare Access (below). Leave it out on a VPS without Access.

### 1. Cloudflare Tunnel + Cloudflare Access (recommended)

Free tier, no open port, works on a laptop, this machine or a VPS.

1. Cloudflare Zero Trust → **Networks → Tunnels**: in the tunnel that runs on this machine (or a new one,
   `cloudflared service install <token>`), add a **public hostname**: `squad.example.com` → service
   `http://127.0.0.1:8097`.
2. **Access → Applications → Add → Self-hosted**: domain `squad.example.com`. Policy: *Allow*, include *Emails*:
   the owner's addresses (and the members'). Login method: *One-time PIN* by e-mail.
3. Copy the application's **Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`) into
   `prefs.cfAccess`, and set `prefs.public` and `prefs.publicUrl`.
4. Open `https://squad.example.com`: Cloudflare asks for the e-mail code, then The AI Squad asks for the PIN.

With `cfAccess` set, every request that comes through the tunnel must carry a valid `Cf-Access-Jwt-Assertion`
(checked against the team's public keys); the e-mail in it goes into `auth.signed_in`. The PIN and the session are
still required behind it. A server also bound to the LAN (`--host 0.0.0.0`) keeps answering LAN browsers directly,
with the PIN and a session but without Access. Target webhooks and worker machines that call in through the tunnel
need an Access *Bypass* or *Service Auth* policy for their paths (`/api/kpi/hook/*`, `/api/nodes/*`).

### 2. Caddy or Nginx with HTTPS on a VPS

Caddy gets the certificate and forwards the WebSocket upgrade and the `X-Forwarded-*` headers by itself:

```
squad.example.com {
  reverse_proxy 127.0.0.1:8097
}
```

Nginx (certificate from certbot):

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
  listen 80;
  server_name squad.example.com;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl http2;
  server_name squad.example.com;
  ssl_certificate     /etc/letsencrypt/live/squad.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/squad.example.com/privkey.pem;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:8097;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 300s;
  }
}
```

The `X-Forwarded-For` line is required: without it every request looks like it comes from the machine itself.

### 3. Tailscale (private only)

`tailscale serve --bg http://127.0.0.1:8097` publishes the server at `https://<machine>.<tailnet>.ts.net`, reachable
only from devices in your tailnet. Set `prefs.public: true` so the session sign-in applies there too. Do not use
Tailscale Funnel for this: it opens the address to the internet.

### VPS checklist

- **Software**: Node.js 22 or newer, tmux and git (`/aisquad doctor` checks them).
- **Claude**: sign in with `claude` once (agents at a Desk use that login); background runs can use an API key
  instead (Menu → Claude sign-in, `docs/BILLING.md`).
- **Memory**: about 1 GB for the system and the server plus 0.5 to 1 GB per agent running at once. 4 GB runs 2 or
  3 agents, 8 GB about 6. The doctor warns below 8 GB; set the Building maximum in Menu → Backups and health.
- **Repositories**: clone them on the VPS, or let `restore` clone them from their remotes.
- **Move a Building**: `/aisquad backup --passphrase-env PASS --with-secrets` on the old machine, copy the file,
  `/aisquad restore <file> --projects-dir ~/projects --passphrase-env PASS` on the VPS (see the README, *Backups and
  moving to another machine*). Sessions and the PIN lock are not backed up: everyone signs in again.
- **Firewall**: open only 22 and the proxy's ports (80 and 443 for Caddy or Nginx; none for a Cloudflare Tunnel or
  Tailscale). Never open 8097.
- **Check**: `/aisquad doctor` warns when the server is bound off loopback without public mode, when public mode has
  no HTTPS in front (no `X-Forwarded-Proto: https`), when the session store is not mode 600, and shows the PIN lock.

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
