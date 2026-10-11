# Channel YOLO mode

Channel YOLO is an owner-reviewed, channel-scoped auto-approval policy for a
user-created group/channel. It lives on the room (`WireGroup.yolo`,
`shared/wire.ts`); a channel-local policy never follows its bots elsewhere.
Missing policy means **Ask**: every protected action waits for approval.

This is an OpenMausBot **permission broker**, not a provider-native global
bypass. It never enables a provider `--yolo` / `bypassPermissions` mode
globally (see `docs/approval-levels.md` for the separate per-bot provider
modes). The provider's own sandbox still applies, and every automatic action
costs the same as a manual one.

## Enable / disable

Use the room's YOLO control (header chip + `RoomYoloPanel` in
`src/components/GroupView.tsx`). The chip reads `Ask` when off and
`YOLO active` when a policy is set. No chip is rendered in DMs, to remote
clients, or while room setup is pending.

- **Enable:** review scope in the panel, press **Enable YOLO**, then confirm
  once in the single summary dialog (folder, tool categories, integrations,
  external writes, limits). Confirming sends one
  `PATCH /api/groups/:id` with `{ yolo: { …activatedAt: Date.now() } }`.
  Later actions do not ask again until a cap stops them or you disable.
- **Disable:** **Disable YOLO** sends `PATCH /api/groups/:id` with
  `{ yolo: null }` immediately, with no confirmation step.
- **Availability:** only user-created channels. The server rejects DMs and
  installed-package rooms with `YOLO is available only for user-created
  channels` (`server/index.ts`, `updateChannel`).
- **Folder:** the approved folder is the room's selected folder
  (`pinnedCwd ?? cwd`), shown read-only; edit it via the working-folder
  control first. Enabling requires a folder. If the room folder changes after
  enabling, the panel warns: disable and re-enable to re-scope.
- Invalid input is rejected with `400` and changes nothing:
  `YOLO settings are invalid; no permissions were changed.`

No transcript content or tool output can alter the policy. Only the PATCH
body's `yolo` field is validated by `parseGroupYoloPolicy`
(`server/group-yolo.ts`): `mode` must be `"yolo"`, workspace must be an
absolute path (≤4096 chars, no control/format characters) that also passes
`validateBotCwd` as an existing folder (stored canonicalized via
`realpathSync`), `allowedTools` must be a subset of
`shell | files | web | integrations`, `allowedIntegrations` at most 64 slugs
matching `/^[a-z][a-z0-9_-]{0,31}$/i`, `externalWrites` exactly
`{ communications, publishing, payments, production }` booleans,
`activatedAt` a positive safe integer, optional `maxActions` 1–1000 and
`maxMinutes` 1–480, and no unknown keys.

## Scope

Auto-approval covers **only** the reviewed scope, inside the approved folder:

- **Tool categories** (`allowedTools`): `shell` (any command, or
  bash/shell/exec/execute/command/powershell/run_command), `files`
  (read/edit/write/multiedit/notebookedit/glob/grep/ls/list_files/search_files),
  `web` (websearch/web_search/webfetch/web_fetch), `integrations`
  (connected-app actions). Unticked categories still ask.
- **Integrations** (`allowedIntegrations`): allow-list of `mcp__<slug>__<tool>`
  slugs, comma-separated in the UI. Anything else still asks.
- **External writes** (`externalWrites`, all off by default): `communications`
  (outbound tools per `shared/outbound.ts`), `publishing` (npm/pnpm/yarn/cargo
  publish, twine upload, docker push, git push, gh release), `payments`
  (pay/payment/charge/refund/purchase/checkout/invoice/transfer/payout),
  `production` (kubectl/terraform apply, vercel `--prod`, fly deploy,
  production deploys/releases). Anything not ticked still asks.
- **Workspace:** shell `cwd` and every declared file path must resolve inside
  the policy workspace. Checks use real paths, and for not-yet-created files
  the nearest existing ancestor, so a symlinked parent cannot escape scope.
- **Caps (optional):** `maxActions` and `maxMinutes`. Empty means no cap. When
  one is reached, automatic approval stops and actions ask again.
  `groupYoloActive()` is false once `now >= activatedAt + maxMinutes*60000`;
  per-action verdicts also block with `limit: true` on action or duration
  exhaustion.

## Fail-closed behavior

`groupYoloVerdict()` returns `null` for questions and blocks anything
uncertain or out of scope. An allow requires a known category, declared
arguments, and a verifiable workspace. In particular, all of these block
(i.e. fall back to asking, or stay blocked):

- Provider questions (`requestType: "question"`) — never auto-answered.
- Unknown/unparseable driver actions (no shell/files/web/integration match).
- `files` actions that declare no path — the boundary cannot be verified.
- Tool category not ticked, integration slug not allow-listed, or matched
  external-write category not enabled.
- Computer control (`approvalScope: "local-computer"` or `mcp__computer__*`).
- Broader sandbox requests (`requiresExplicitApproval`) — YOLO cannot widen
  the provider sandbox.
- Credential/sensitive paths (`.ssh`, `.aws`, `.gnupg`, `.netrc`, `.npmrc`,
  `.kube`, docker config, `id_rsa`/`id_ed25519`, `credentials.json`, `.env`
  variants, `/etc/shadow|gshadow`).
- OpenMausBot security controls: `groups.json`, `bots.json`,
  `.claude/settings(.local).json`, `.codex/config.toml`, `.mcp.json`, API
  routes for groups/bots/config, loopback/localhost-server commands, or paths
  under the data dir.
- Shell `cwd` or any file path outside the approved workspace.
- Expired `maxMinutes` or exhausted `maxActions`.

Consequence: a provider/driver with no safe structured permission event or no
path metadata cannot be auto-approved, so the task may stay blocked waiting
for approval. Ask questions, report the blocker, and either narrow the work
into scope or disable YOLO — do not work around the boundary.

## Stop

While the room works, **Stop execution** (`RoomStopButton`) posts the existing
`POST /api/groups/:id/interrupt` with that conversation's `threadId` and
interrupts the live provider turn. It ends the running turn; it does not
disable the YOLO policy.

## Audit

No YOLO-specific audit row is evidenced in the current source:
`groupYoloVerdict` / `groupYoloActive` are defined and unit-covered through
policy persistence, but `server/index.ts` in this tree imports them only for
the `PATCH` validation path — there is no wired permission-broker call site
yet, so do not claim automatic approvals are logged. What is evidenced:

- Policy changes arrive only via the validated channel PATCH above.
- Permission outcomes generally are recorded by the authorization decision log
  (`server/decision-log.ts`: `auto-approved` / `auto-denied` / `card-shown` /
  `user-*` rows). Whether a future YOLO broker call site emits such rows is
  not visible here.
