# Local Docker Compose

From the repository root, run `docker compose up -d --build`, then open
http://localhost:8080. Docker with Linux containers is required.
Compose supplies defaults; no `.env` file is required.
The application container uses Docker's init process to reap orphaned agent
subprocesses.

To customize, copy `.env.example` to `.env` in the repository root.
The `.env` file is ignored by Git. Shell environment variables take precedence.
`OMB_HTTP_PORT` changes the host port and the default public URL.
Internal service ports remain fixed inside the shared network namespace.
`ENGINES` selects space-separated npm packages; an empty value skips installation.
The image also carries Grok Build, pinned by `GROK_VERSION` in
`deploy/local/Dockerfile`; Grok and Codex sign in from the app's engine setup
with a one-time code, no terminal needed.

For Tailscale Serve, set `OMB_PUBLIC_URL` to your HTTPS URL and
`OMB_HTTPS_HOST` to its hostname without scheme or path. Configure Tailscale
Serve on the host to forward to the chosen localhost HTTP port.
Keep the default `OMB_BIND_ADDRESS=127.0.0.1`. Caddy refuses to start when
`OMB_HTTPS_HOST` is set with any other bind address, so direct remote HTTP
clients cannot claim HTTPS semantics by supplying that hostname.
The hostname mapping preserves HTTPS
semantics for that host while localhost access continues to use HTTP.
Private tailnet webhook URLs are only reachable by callers on that tailnet.
Without `OMB_HTTPS_HOST`, the bind address can be changed for HTTP access.
Only use HTTPS hostname mapping with a trusted local TLS-terminating proxy.

The container must also resolve the public Tailscale name to this machine's
tailnet IP. A successful HTTPS request from the host does not prove container
reachability: interactive phone pairing checks the public environment descriptor
from inside the `omb` container before creating a code. If the container does not
use MagicDNS, add an `extra_hosts` entry for the Tailscale hostname and IP under
`services.omb` in `compose.override.yaml`, then run `docker compose up -d`.
Keep TLS validation and the workspace-identity check enabled. Check both from
inside the container with this read-only command:

```sh
docker compose exec -T omb node -e 'const assert = require("node:assert/strict"); (async () => { const path = "/.well-known/openmausbot/environment"; const urls = [`http://127.0.0.1:${process.env.OMB_PORT || 8799}${path}`, `${process.env.OMB_PUBLIC_URL}${path}`]; const descriptors = await Promise.all(urls.map(async url => { const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" }); assert.equal(r.status, 200); return r.json(); })); assert.ok(descriptors[0].environmentId); assert.equal(descriptors[1].environmentId, descriptors[0].environmentId); console.log("HTTPS identity: OK"); })().catch(e => { console.error(e.message); process.exitCode = 1; });'
```

Verify phone pairing interactively with `docker compose exec omb node
dist-server/openmausbot.js pair --phone ios`; using `exec -T` skips the
interactive reachability check.

Sign in and pair a browser:

```sh
docker compose exec omb codex login --device-auth
docker compose exec omb node dist-server/openmausbot.js pair
```

On Windows, `./maus.ps1` forwards arguments to Compose using the repository
directory. It respects Docker's selected context and `DOCKER_CONTEXT`.

## Hub: this server controlling other VPSs (spokes)

The brain stays here; spokes run only Docker commands and a managed desktop
container. The agent process never leaves this machine.

Prerequisites (host): an SSH alias per spoke with `IdentitiesOnly yes`, a
dedicated key (root-equivalent: Docker access = root on the spoke), and a
firewall allowing SSH only. Staged for the container under `/opt/omb-hub-ssh/`
(`config`, `hub_servers_key`, `known_hosts`, all `600`, `chown 1001:1001`),
mounted read-only at `/data/.ssh/` via `compose.override.yaml`. The image
(`deploy/local/Dockerfile`) adds `openssh-client` + a pinned static docker
client, because the base image ships neither.

Register one alias (global, single — see `server/config.ts` `vpsSshAlias`):

```sh
docker compose exec -T omb node -e 'fetch("http://127.0.0.1:8799/api/config",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({vps:{sshAlias:"srv2"}})}).then(async r=>console.log(r.status,await r.text()))'
```

Per bot: set **Works on → Cloud + Self-hosted VPS**; enable **Start VPS
automatically** only if Auto may create/wake its managed container. The
managed container publishes no ports, has no host mounts, and is disposable —
move results out before deleting/upgrading.

Read-only hub check (transport + alias + inventory, no lifecycle change):

```sh
docker compose exec -T omb node -e 'const assert = require("node:assert/strict"); (async () => { const cfg = await (await fetch("http://127.0.0.1:8799/api/config")).json(); assert.equal(cfg.vps.sshAlias, "srv2"); const inv = await (await fetch("http://127.0.0.1:8799/api/computers/vps", { signal: AbortSignal.timeout(90000) })).json(); assert.equal(inv.configured, true); assert.equal(inv.available, true); assert.equal(inv.sshAlias, "srv2"); assert.equal(inv.problem, null); console.log("HUB SPOKE: OK"); })().catch(e => { console.error(e.message); process.exitCode = 1; });'
```

## Git/GitHub on the brain

Agents and shells inside `omb` can use git over SSH and `gh` for PRs/issues.
The image adds a pinned static `gh` (`deploy/local/Dockerfile`, `GH_VERSION`);
the host stages `/opt/omb-hub-ssh/id_ed25519_git` (600, uid 1001, read-only
mount at `/data/.ssh/`) plus a `github.com` block in the container SSH config,
and `/opt/omb-hub-gh/{hosts,config}.yml` (600, uid 1001, read-only mounts at
`/data/.config/gh/`). Private key and token never enter the image. Rotate by
replacing the host files and recreating the container (`up -d`); no rebuild.

Read-only git check:

```sh
docker compose exec -T omb sh -c 'gh auth status && ssh -o BatchMode=yes -i /data/.ssh/id_ed25519_git git@github.com'
```

## Remote AI instances (9router)

Remote `image/computer` connections require strict HTTPS. For an `openai-compat` instance (e.g., 9router) over Tailscale, use Tailscale Serve on a dedicated port (e.g., `https://srv1828816.tailc19c44.ts.net:8446/v1`) without Funnel. 
The container must natively resolve the Tailscale hostname. Add the corresponding `extra_hosts` mapping in `compose.override.yaml` so TLS validation passes without bypasses:
```yaml
services:
  omb:
    extra_hosts:
      - "srv1828816.tailc19c44.ts.net:100.67.117.91"
```

## Bot shell for git/files (MCP hub-shell)

`openai-compat` bots (e.g. 9router) have no local shell by design
(`server/workspace.ts` excludes the driver). `hub-shell` closes that gap: a
scoped MCP stdio server living at `/data/hub-shell/hub-shell.mjs` in the
volume (source of truth: `/opt/omb-hub-shell/hub-shell.mjs` on the host),
registered as MCP server `hub-shell` and granted per bot.
Tools: `git_clone`, `git_pull`, `repo_inspect`, `file_read`, `file_write` —
all jailed to `/data/repos` (github.com only, 200KB caps, `.git` refused,
`..` refused). Every call rides the normal approval flow.
Repos are visible on the host at `/opt/omb-repos` (symlink into the volume).
Edit the host source, copy into the volume (`chown 1001:1001`), no rebuild.
Clones under `/data/repos` must be owned by the runtime user (`maus`, uid
1001): a root-owned repo fails every git call returning `isError=true` with a Git dubious ownership message. Fix only that repo (`chown -R 1001:1001
/data/repos/<name>`, modes/conteúdo preservados); never `safe.directory=*`,
never chown `/data` global. Approval das chamadas continua Ask/Auto por bot
— Auto ainda abre card (`native-approval`); só Full aprova sozinho, e Full
exige o app desktop empacotado ou a concessão explícita do operador no startup auto-hospedado (abaixo).

## Operator Full Access (self-hosted startup grant)

Full normally requires the packaged desktop app. On self-hosted Docker only,
the operator may opt in selected bots at startup with
`OMB_OPERATOR_FULL_ACCESS_BOT_IDS`: exact comma-separated bot IDs, unique,
no blanks (`"bot-id-1,bot-id-2"`). Only the listed bots move to Full, across
all existing and future threads: destructive commands, edits, and computer
actions run without confirmation cards. Anything else stays Ask/Auto.
There is no HTTP/API way to request this grant; it is startup environment
only, never a bot tool.
Startup validates everything before writing anything, and refuses to boot on
desktop (`OMB_DESKTOP_PARENT=1`), hosted workspace, or Cloud home; on a
missing bot, a pending approval grant, an unsupported provider on the bot
default or any existing thread, or a duplicate/malformed ID list.
Enable in `compose.override.yaml`, then recreate:

```yaml
services:
  omb:
    environment:
      OMB_OPERATOR_FULL_ACCESS_BOT_IDS: "bot-id-1,bot-id-2"
```

```sh
docker compose up -d
```

The grant persists in the data volume. To revoke: remove the IDs (or the
variable), recreate with `docker compose up -d`, then set each bot back to
Ask in the app/supported API. Removing the variable alone does not downgrade
already-granted bots.



## Project areas (Projetos vs Bots)

Bots are people (fixed, shared). Projects are rooms: a section + a folder
under `/data/repos` + a team group. `project_open {url, project, members,
chief}` (hub-shell MCP) clones/pulls and creates a project room with its own
cwd and chief responder, without moving bots or changing their permissions.
`/opt/omb-repos` (symlink into the volume).

O MCP retorna falhas da API (HTTP 4xx/5xx) e de infra com `isError=true`.
Todos os membros precisam ter `hub-shell` habilitado previamente no app. O `project_open` não amplia acesso nem exige que bots de outras conversas parem. Repetir a mesma equipe/projeto reutiliza a sala; uma falha ao configurar a pasta identifica a sala remanescente e permite retomar sem duplicá-la. Repo e sala não são uma transação atômica em rede.
Execute o check isolado com fake-engine em modo `hang`: `FIXTURE_URL=<url> FIXTURE_DATADIR=<dir> /opt/omb-hub-shell/verify-project-open.sh`. Verifica bot ocupado, cwd/responsável da sala, perfis preservados, repetição sem duplicação e recuperação de falha de pasta.

## Sidebar fork (project sections show teams only)

Upstream shows bots + groups per section. Our fork (`danjour/OpenMausBot`
branch `hub/sidebar-project-teams`, served via bind mount
`/opt/openmausbot/dist:/app/dist:ro`): a user section with ≥1 group and
empty search renders group rows only — member/chief bot rows hidden but
working. Search brings bots back; built-ins, collapse, drag, team map
untouched. Tests: `SidebarProjectTeams`, `SidebarMunicipalProof`.
Maintain: rebase onto upstream main, `pnpm exec vite build`, recreate.
Remove the mount to go back to stock.



Data and engine credentials persist in the named data volume. For an existing
volume, set `OMB_DATA_VOLUME` to its name and `OMB_DATA_EXTERNAL=true`.
Fresh installs create their volume automatically.

Update with `docker compose build --pull` followed by `docker compose up -d`.
Stop with `docker compose stop`. `docker compose down -v` deletes managed volumes.

### Coordinated Restart (Caddy and OMB)

The `caddy` proxy shares the `omb` container's network namespace (`network_mode: service:omb`). Restarting the `omb` container independently destroys this shared namespace, which will leave `caddy` isolated and result in `502 Bad Gateway` errors. 
Always restart both containers together to preserve network routing:

```sh
docker compose restart omb caddy
```
