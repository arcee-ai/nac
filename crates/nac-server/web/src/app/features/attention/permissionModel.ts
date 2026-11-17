import type { PermissionApprovalMode, PermissionRequest } from "@/app/types/api";

type Resource = PermissionRequest["resources"][number];

export const MODE_OPTIONS: {
  mode: PermissionApprovalMode;
  name: string;
  description: string;
}[] = [
  {
    mode: "manual",
    name: "Manual",
    description: "Each request pauses until you approve or deny it.",
  },
  {
    mode: "auto_approve",
    name: "Approve all",
    description:
      "Automatically allows ordinary requests after they reach the permission broker. Hard and configured denials still apply.",
  },
  {
    mode: "review",
    name: "Approve for me",
    description:
      "Eligible requests are reviewed automatically, and routine ones are allowed once. Ineligible requests still ask you. A rejected, uncertain or unavailable review leaves the action unexecuted and returns it to the agent; it does not open a manual prompt. You can switch to Manual to decide requests yourself. Uses your Arcee sign-in or Arcee API key.",
  },
];

export function modeName(mode: PermissionApprovalMode | undefined): string {
  return MODE_OPTIONS.find((option) => option.mode === mode)?.name ?? "Manual";
}

/** Human names for the broker's resource actions; unknown actions fall back to their own words. */
const ACTION_LABELS: Record<string, string> = {
  execute: "Command",
  execute_broad: "Broad authority",
  execute_opaque: "Unparsed shell",
  execute_cwd: "Working directory",
  execute_path: "Path argument",
  edit: "Edit",
  read: "Read",
  glob: "Find files",
  grep: "Search files",
  external_directory: "Outside the workspace",
  terminal_input: "Terminal input",
  terminal_observe: "Terminal output",
  terminal_retain: "Keep terminal",
  command_output: "Command output",
  web_fetch: "Fetch",
  web_search: "Web search",
  mcp_call: "MCP tool",
  subagent: "Subagent",
  heartbeat_manage: "Scheduled task",
  heartbeat_retained_manage: "Scheduled task",
  heartbeat_run: "Run scheduled task",
  task_read: "Task",
  count: "Count",
};

export function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface Question {
  /** Which actions the question is about; their resources lead the card. */
  actions: readonly string[];
  title: string;
}

/** First match wins, so a command that also edits a path still reads as a command. */
const QUESTIONS: readonly Question[] = [
  { actions: ["execute", "execute_broad", "execute_opaque"], title: "Run this command?" },
  { actions: ["terminal_input"], title: "Send this to the terminal?" },
  { actions: ["edit"], title: "Edit file?" },
  { actions: ["read"], title: "Read file?" },
  { actions: ["glob", "grep"], title: "Search files?" },
  { actions: ["web_fetch"], title: "Fetch this page?" },
  { actions: ["web_search"], title: "Search the web?" },
  { actions: ["subagent"], title: "Start a subagent?" },
  {
    actions: ["heartbeat_manage", "heartbeat_retained_manage", "heartbeat_run"],
    title: "Change a scheduled task?",
  },
  { actions: ["external_directory"], title: "Work outside the workspace?" },
];

export interface PermissionPresentation {
  /** Tool-specific question: "Run this command?", "Edit file?", "Use tool?". */
  title: string;
  /** The resources the question is about, in the broker's order. */
  primary: Resource[];
  /** Every other resource the same reply authorizes. Nothing is left out. */
  secondary: Resource[];
  /** Whether the primary text is a command line, which reads best unwrapped. */
  command: boolean;
}

/**
 * What a request asks, for the card above the composer. It only arranges the
 * broker's own resources; every one of them stays on screen, because each is
 * part of what a single reply authorizes.
 */
export function presentPermission(request: PermissionRequest): PermissionPresentation {
  const question = QUESTIONS.find((candidate) =>
    request.resources.some((resource) => candidate.actions.includes(resource.action)),
  );
  if (!question) {
    return { title: "Use tool?", primary: request.resources, secondary: [], command: false };
  }
  // The broad/opaque notes explain the command rather than restating it, so
  // they follow it as secondary rows.
  const lead =
    question.actions[0] === "execute" &&
    request.resources.some((resource) => resource.action === "execute")
      ? ["execute"]
      : question.actions;
  const primary = request.resources.filter((resource) => lead.includes(resource.action));
  const secondary = request.resources.filter((resource) => !lead.includes(resource.action));
  return {
    title: question.title,
    primary,
    secondary,
    command: lead.includes("execute") || lead.includes("terminal_input"),
  };
}

export interface RememberedScope {
  action: string;
  /** Exactly what the broker stores for "always", byte for byte. */
  scope: string;
}

/** The grants an "always" reply would store: one per resource carrying a save pattern. */
export function rememberedScopes(request: PermissionRequest | null): RememberedScope[] {
  if (!request) return [];
  return request.resources.flatMap((resource) =>
    resource.save_resource ? [{ action: resource.action, scope: resource.save_resource }] : [],
  );
}

/**
 * A readable spelling of a stored command pattern: `command:[git][status]*`
 * reads `git status *`. Anything else is returned unchanged, so a pattern the
 * client does not understand is never paraphrased.
 */
export function readableScope(scope: string): string {
  const match = /^command:((?:\[[^\]]*\])+)(\*?)$/u.exec(scope);
  if (!match) return scope;
  const tokens = [...match[1].matchAll(/\[([^\]]*)\]/gu)].map((token) => {
    try {
      return decodeURIComponent(token[1]);
    } catch {
      return token[1];
    }
  });
  return `${tokens.join(" ")}${match[2] ? " *" : ""}`;
}

/** The label for the "always" choice, naming the rule when there is exactly one. */
export function alwaysAllowLabel(scopes: RememberedScope[]): string {
  if (scopes.length === 0) return "Always allow";
  if (scopes.length === 1) return `Always allow ${readableScope(scopes[0].scope)}`;
  return `Always allow these ${scopes.length} rules`;
}
