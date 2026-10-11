import { isAbsolute, relative, resolve, sep } from "node:path";
import { isOutboundTool } from "../shared/outbound.ts";
import type { GroupYoloPolicy, YoloToolCategory } from "../shared/wire.ts";

export const YOLO_TOOL_CATEGORIES = ["shell", "files", "web", "integrations"] as const;
export const YOLO_MAX_ACTIONS = 1_000;
export const YOLO_MAX_MINUTES = 480;
const INTEGRATION = /^[a-z][a-z0-9_-]{0,31}$/i;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

export type ParsedGroupYoloPolicy = { ok: true; policy: GroupYoloPolicy } | { ok: false; error: string };
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function parseGroupYoloPolicy(value: unknown): ParsedGroupYoloPolicy {
  const invalid = (): ParsedGroupYoloPolicy => ({ ok: false, error: "YOLO settings are invalid; no permissions were changed." });
  if (!record(value) || value.mode !== "yolo" || typeof value.workspace !== "string" ||
      value.workspace.length > 4096 || CONTROL.test(value.workspace) || !isAbsolute(value.workspace) ||
      !Array.isArray(value.allowedTools) || !Array.from(value.allowedTools).every((entry) =>
        typeof entry === "string" && (YOLO_TOOL_CATEGORIES as readonly string[]).includes(entry)) ||
      !Array.isArray(value.allowedIntegrations) || value.allowedIntegrations.length > 64 ||
      !Array.from(value.allowedIntegrations).every((entry) => typeof entry === "string" && INTEGRATION.test(entry)) ||
      !record(value.externalWrites) ||
      !["communications", "publishing", "payments", "production"].every((key) => typeof value.externalWrites![key] === "boolean") ||
      Object.keys(value.externalWrites).some((key) => !["communications", "publishing", "payments", "production"].includes(key)) ||
      !Number.isSafeInteger(value.activatedAt) || (value.activatedAt as number) <= 0 ||
      (value.maxActions !== undefined && (!Number.isInteger(value.maxActions) || (value.maxActions as number) < 1 || (value.maxActions as number) > YOLO_MAX_ACTIONS)) ||
      (value.maxMinutes !== undefined && (!Number.isInteger(value.maxMinutes) || (value.maxMinutes as number) < 1 || (value.maxMinutes as number) > YOLO_MAX_MINUTES)) ||
      Object.keys(value).some((key) => !["mode", "workspace", "allowedTools", "allowedIntegrations", "externalWrites", "maxActions", "maxMinutes", "activatedAt"].includes(key))) {
    return invalid();
  }
  return { ok: true, policy: {
    mode: "yolo",
    workspace: resolve(value.workspace),
    allowedTools: [...new Set(value.allowedTools as YoloToolCategory[])],
    allowedIntegrations: [...new Set(value.allowedIntegrations as string[])],
    externalWrites: {
      communications: value.externalWrites.communications as boolean,
      publishing: value.externalWrites.publishing as boolean,
      payments: value.externalWrites.payments as boolean,
      production: value.externalWrites.production as boolean,
    },
    ...(value.maxActions === undefined ? {} : { maxActions: value.maxActions as number }),
    ...(value.maxMinutes === undefined ? {} : { maxMinutes: value.maxMinutes as number }),
    activatedAt: value.activatedAt as number,
  } };
}

export function groupYoloActive(policy: GroupYoloPolicy | undefined, now = Date.now()): boolean {
  return Boolean(policy && (!policy.maxMinutes || now < policy.activatedAt + policy.maxMinutes * 60_000));
}

/** Use real paths for existing targets and the nearest existing ancestor for
 * not-yet-created files. This prevents a symlinked parent from escaping scope. */
export function pathWithinWorkspace(workspace: string, candidate: string, realpath: (path: string) => string): boolean {
  const root = realpath(resolve(workspace));
  let target = resolve(candidate);
  for (;;) {
    try {
      target = realpath(target);
      break;
    } catch {
      const parent = resolve(target, "..");
      if (parent === target) return false;
      target = parent;
    }
  }
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export interface GroupYoloRequest {
  tool: string;
  summary: string;
  requestType: "permission" | "question";
  command?: { command: string; cwd: string };
  paths?: string[];
  requiresExplicitApproval?: boolean;
  approvalScope?: "local-computer";
}

export type GroupYoloVerdict =
  | { decision: "allow"; category: YoloToolCategory | "integration" }
  | { decision: "block"; reason: string; limit?: boolean };

const integrationTool = (tool: string) => tool.match(/^mcp__([a-z][a-z0-9_-]{0,31})__(.+)$/i);

const bareTool = (name: string) => (integrationTool(name)?.[2] ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "_");

function actionCategory(tool: string, hasCommand: boolean): { category: YoloToolCategory | "integration"; integration?: string; name: string } | undefined {
  const mcp = integrationTool(tool);
  const name = bareTool(tool);
  if (hasCommand || ["bash", "shell", "exec", "execute", "command", "powershell", "run_command"].includes(name)) {
    return { category: "shell", name };
  }
  if (["read", "edit", "write", "multiedit", "notebookedit", "glob", "grep", "ls", "list_files", "search_files"].includes(name)) {
    return { category: "files", name };
  }
  if (["websearch", "web_search", "webfetch", "web_fetch"].includes(name)) return { category: "web", name };
  if (mcp) return { category: "integration", integration: mcp[1]!.toLowerCase(), name };
  return undefined;
}

function externalWriteCategory(request: GroupYoloRequest): keyof GroupYoloPolicy["externalWrites"] | undefined {
  const action = `${request.tool} ${request.command?.command ?? ""}`.toLowerCase();
  if (/\b(pay|payment|charge|refund|purchase|checkout|invoice|transfer|payout)\b/.test(action)) return "payments";
  if (/\b(kubectl\s+apply|terraform\s+apply|vercel\s+.*--prod|fly\s+deploy|production\s+deploy|prod(?:uction)?\s+release)\b/.test(action)) return "production";
  if (/\b(npm\s+publish|pnpm\s+publish|yarn\s+publish|cargo\s+publish|twine\s+upload|docker\s+push|git\s+push|gh\s+release)\b/.test(action)) return "publishing";
  if (isOutboundTool(request.tool)) return "communications";
  return undefined;
}

const SENSITIVE_PATH = /(?:^|[\\/\s"'])?(?:\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.kube|\.docker[\\/]config\.json|id_(?:rsa|ed25519)|credentials(?:\.json)?|(?:^|[\\/])\.env(?:\.(?:local|production|development|test))?(?:$|[\\/\s"'])|\/etc\/(?:shadow|gshadow))(?:$|[\\/\s"'])/i;
const SECURITY_CONTROL_PATH = /(?:^|[\\/])(?:groups\.json|bots\.json|\.claude[\\/]settings(?:\.local)?\.json|\.codex[\\/]config\.toml|\.mcp\.json)(?:$|[\\/])/i;
const SECURITY_COMMAND = /(?:\/api\/(?:groups|bots|config)(?:[\s/'"?]|$)|127\.0\.0\.1:\d+|localhost:\d+|\b(?:curl|wget|invoke-webrequest)\b[^\n]*(?:\/api\/(?:groups|bots|config)))/i;

export function groupYoloVerdict(
  policy: GroupYoloPolicy,
  request: GroupYoloRequest,
  context: { now?: number; actionsUsed: number; realpath: (path: string) => string; dataDir?: string },
): GroupYoloVerdict | null {
  if (request.requestType === "question") return null;
  const now = context.now ?? Date.now();
  if (policy.maxMinutes && now >= policy.activatedAt + policy.maxMinutes * 60_000) {
    return { decision: "block", reason: "YOLO duration limit reached; the task was stopped.", limit: true };
  }
  if (policy.maxActions && context.actionsUsed >= policy.maxActions) {
    return { decision: "block", reason: "YOLO action limit reached; the task was stopped.", limit: true };
  }
  if (request.requiresExplicitApproval) return { decision: "block", reason: "The provider requested broader sandbox permissions; YOLO cannot widen the provider sandbox." };
  if (request.approvalScope === "local-computer" || /^mcp__computer__/i.test(request.tool)) {
    return { decision: "block", reason: "Computer-control actions are outside this channel's YOLO scope." };
  }
  const action = actionCategory(request.tool, Boolean(request.command));
  if (!action) return { decision: "block", reason: "This driver action is not covered by the channel's YOLO policy." };
  if (action.category === "integration" && !policy.allowedIntegrations.includes(action.integration!)) {
    return { decision: "block", reason: `Integration ${action.integration} is not authorized for this channel.` };
  }
  if (action.category !== "integration" && !policy.allowedTools.includes(action.category)) {
    return { decision: "block", reason: `The ${action.category} tool category is not authorized for this channel.` };
  }
  const externalCategory = externalWriteCategory(request);
  if (externalCategory && !policy.externalWrites[externalCategory]) {
    return { decision: "block", reason: `${externalCategory} actions are not authorized for this channel.` };
  }
  const inspected = [...(request.paths ?? []), request.command?.command ?? ""].join("\n");
  if (SENSITIVE_PATH.test(inspected)) return { decision: "block", reason: "Access to credentials or sensitive files is blocked by the channel policy." };
  if (SECURITY_CONTROL_PATH.test(inspected) || SECURITY_COMMAND.test(inspected) ||
      (context.dataDir && inspected.toLowerCase().includes(context.dataDir.toLowerCase()))) {
    return { decision: "block", reason: "Changes to OpenMausBot security controls are outside the channel policy." };
  }
  if (request.command && !pathWithinWorkspace(policy.workspace, request.command.cwd, context.realpath)) {
    return { decision: "block", reason: "The command's working directory is outside the authorized workspace." };
  }
  for (const target of request.paths ?? []) {
    if (!pathWithinWorkspace(policy.workspace, target, context.realpath)) {
      return { decision: "block", reason: "The requested file is outside the authorized workspace." };
    }
  }
  if (action.category === "files" && !(request.paths?.length)) {
    return { decision: "block", reason: "The driver did not identify a file path, so the workspace boundary could not be verified." };
  }
  return { decision: "allow", category: action.category };
}
