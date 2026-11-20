import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import { createConfiguredChat } from "@/app/features/setup/workflow";
import { routes } from "@/app/lib/routes";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useCreateSession, useSandboxActivity, useSessions } from "@/app/services/queries";

import { configuredSessionRequest, type ModelOverride } from "./modelChoice";
import { sandboxRequest, type SandboxOptions } from "./workspaceSandbox";
import { requireCurrentSource } from "./sourceSessionModel";

export interface StartRequest {
  projectId: string;
  prompt: string;
  model: ModelOverride;
  sandbox?: SandboxOptions;
}

/**
 * Create a session with the chosen model, deliver the prompt, and open it.
 *
 * The runtime-only first-message intent is consumed by the owning composer
 * after its interactive stream is live. Reload/replacement retains text only,
 * never an executable intent.
 */
export function useStartSession() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const action = useSetupAction();
  const createSession = useCreateSession();
  const { data: allSessions = [] } = useSessions();
  const [sandboxActivityKey, setSandboxActivityKey] = useState<string | null>(null);
  const sandboxActivity = useSandboxActivity(sandboxActivityKey);

  /**
   * A project's first primary session keeps the server's first-chat
   * convergence: concurrent starts in an empty project land in one session.
   */
  const firstChat = (projectId: string) => {
    return {
      first_chat: !allSessions.some(
        (entry) => entry.lineage == null && entry.summary.project_id === projectId,
      ),
      first_chat_same_behavior: true,
    };
  };
  const { api, stores } = useNativeRuntime();
  const { update: updateDraft } = stores.promptDraftStore;
  const [error, setError] = useState<string | null>(null);

  const createWithOverride = (
    request: StartRequest,
    override: ModelOverride,
    current: () => boolean,
    signal: AbortSignal,
  ) => {
    return createConfiguredChat({
      current,
      classify: classifySetupFailure,
      reconcile: setupReconciliation(client),
      persistsModel: false,
      model: async () => {
        await requireCurrentSource(api, request.projectId, override, signal);
        return override.selection;
      },
      chat: async (selected) => {
        const activityKey = request.sandbox ? crypto.randomUUID() : null;
        if (activityKey) setSandboxActivityKey(activityKey);
        try {
          const body = {
            ...configuredSessionRequest({
              projectId: request.projectId,
              selected,
            }),
            ...firstChat(request.projectId),
            first_chat_require_matching_model: true,
            ...(override.source
              ? {
                  first_chat: false,
                  model_source: {
                    project_id: override.source.projectId,
                    session_id: override.source.sessionId,
                    config_version: override.source.configVersion,
                  },
                }
              : {}),
          };
          const snapshot = await createSession.mutateAsync(
            request.sandbox && activityKey
              ? {
                  ...body,
                  first_chat: false,
                  sandbox: sandboxRequest(request.sandbox, activityKey),
                }
              : body,
          );
          return snapshot.metadata.session_id ?? null;
        } finally {
          if (activityKey) setSandboxActivityKey(null);
        }
      },
    });
  };

  /** Opens an empty session (no prompt typed): the composer there takes over. */
  const start = async (request: StartRequest): Promise<boolean> => {
    if (action.busy || action.needsReview) return false;
    setError(null);
    try {
      const sessionId = await action.run((lease) =>
        createWithOverride(request, request.model, lease.current, lease.signal),
      );
      if (!sessionId) return false;
      if (request.prompt.trim()) {
        const draft = updateDraft(sessionId, request.prompt);
        stores.composerStore.scheduleFirstPrompt(sessionId, draft);
      }
      navigate(routes.session(sessionId));
      return true;
    } catch (cause) {
      setError(setupFailureMessage(cause));
      return false;
    }
  };

  return {
    start,
    busy: action.busy,
    /** An uncertain configured create needs a fresh review (reload) before retrying. */
    needsReview: action.needsReview,
    error,
    sandboxProgress: sandboxActivityKey
      ? (sandboxActivity.data?.phase ?? "Creating the sandbox…")
      : null,
    clearError: () => setError(null),
  };
}
