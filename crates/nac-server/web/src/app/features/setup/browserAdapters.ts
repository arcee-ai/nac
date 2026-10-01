import type { QueryClient } from "@tanstack/react-query";

import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { ApiError } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import { SetupFailure, type FailureKind, type SetupPhase } from "./workflow";

export class SetupValidation extends Error {}

export class ConfigurationChanged extends Error {
  constructor() {
    super(
      "This chat's settings changed. Reopen settings to review the current values before saving.",
    );
  }
}

export function classifySetupFailure(cause: unknown, phase?: SetupPhase): FailureKind {
  if (cause instanceof SetupValidation) return "rejected";
  if (cause instanceof ConfigurationChanged) return "conflict";
  if (cause instanceof ApiError) {
    // Project creation has no revision update: a duplicate folder is a known
    // rejection. An edited folder is a new intent, never an automatic retry.
    if (phase === "project" && cause.status === 409) return "rejected";
    return cause.status === 409 ? "conflict" : cause.status >= 500 ? "unknown" : "rejected";
  }
  return "unknown";
}

export function setupFailureMessage(error: unknown): string {
  if (!(error instanceof SetupFailure)) return humanErrorText(toRunError(error));
  if (error.kind === "cancelled") return "This setup view was closed.";
  const partial = error.completed.includes("configuration")
    ? "Chat settings were saved. "
    : error.completed.includes("project")
      ? "The project was saved. "
      : error.completed.includes("preset")
        ? "The preset was saved. "
        : "";
  if (error.kind === "unknown")
    return `${partial}The ${error.phase} save outcome is unknown. Refresh and review the saved values before trying again.`;
  if (error.kind === "conflict")
    return `${partial}The ${error.phase} changed or is busy. Refresh and review before saving again. ${humanErrorText(toRunError(error.cause))}`;
  return `${partial}${humanErrorText(toRunError(error.cause))}${error.completed.length ? " Reopen setup to review the saved values before continuing." : ""}`;
}

/** Cache settlement is captured from the origin, with no presentation callbacks. */
export function setupReconciliation(client: QueryClient, sessionId?: string) {
  return async (phase: SetupPhase) => {
    const keys =
      phase === "preset"
        ? [queryKeys.modelConfigs, queryKeys.modelCatalog, queryKeys.credentials]
        : phase === "project" || phase === "default"
          ? [queryKeys.projects]
          : sessionId
            ? [
                queryKeys.sessionConfig(sessionId),
                queryKeys.sessionSnapshot(sessionId),
                queryKeys.sessionsAll,
              ]
            : [queryKeys.sessionsAll];
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
  };
}
