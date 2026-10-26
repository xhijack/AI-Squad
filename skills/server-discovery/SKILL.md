---
name: server-discovery
description: "Read-only inventory of a server over ssh, assuming it may be SHARED with other apps: containers, ports, networks, volumes, reverse proxy sites, systemd units, cron, CPU/RAM/disk, free port ranges and conflict risks. Writes docs/ops/SERVER-<host>.md and changes nothing. Use as DevOps before planning any install or deploy on a server."
---
# Server discovery (read-only)

Goal: know what already runs on the server before the squad puts anything on it. **You change nothing.** Every command below only reads.

## Rules
- Treat the server as shared with apps that are not ours, even when the owner says it is empty.
- Read-only commands only. No `docker rm`, `prune`, `stop`, `restart`, `systemctl start/stop/enable`, `apt`, `kill`, edits to files, and no `sudo` for anything that writes.
- If a command needs `sudo` to read, ask the owner to run it and paste the output. Never ask for a password in chat.
- Never print or copy secrets: skip `env` dumps, `.env` files, `docker inspect` output with environment values, and private keys. Write variable **names** only.
- Use the ssh host alias or user@host the owner gave you. Do not change `~/.ssh/config` and do not add keys.

## Inventory (run each, keep the useful part)
1. **Machine:** `hostname; uname -a; cat /etc/os-release | head -3; uptime; nproc; free -m; df -h -x tmpfs -x devtmpfs`
2. **Containers:** `docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`, `docker compose ls`, `docker network ls`, `docker volume ls`, `docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'`
3. **Ports in use:** `ss -ltnp` (without sudo the process names may be missing; that is fine)
4. **Reverse proxy:** which one runs (nginx, Caddy, Traefik, Coolify). List the sites (`ls /etc/nginx/sites-enabled`, `ls /etc/caddy`, Traefik labels in `docker ps`), each with its domain and upstream port.
5. **Services:** `systemctl list-units --type=service --state=running --no-pager`, `systemctl --user list-units --no-pager` if relevant.
6. **Scheduled jobs:** `crontab -l` (yours), `ls /etc/cron.d`, `systemctl list-timers --no-pager`
7. **Git and app folders:** where apps live (`/srv`, `/opt`, `~/apps`, Coolify data); do not open their config files.

## Analysis
- **Free port ranges:** ranges with no listener, avoiding well-known ports and the neighbours' ranges (for example "8300-8399 free").
- **Conflict risks:** ports, container or network names, volume names, domains or cron times our app could collide with; a reverse proxy we would have to edit; memory headroom (free RAM and swap after the current load).
- **Who owns what:** mark everything as "not ours" unless it is clearly from this project.

## Output: docs/ops/SERVER-<host>.md
Sections: Summary (one paragraph: shared or not, headroom, the main risk) · Machine · Containers and compose projects (table) · Ports in use (table) · Reverse proxy sites (table) · Services and timers · Free port ranges · Conflict risks · Needs the owner (anything that needs sudo or a decision) · Date and the commands used.
Report to whoever gave you the task: the file, the free ranges and the top three risks.
