import type { ServiceTier } from "@/app/lib/serviceTier";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import { createConfiguredChat, setupSequence } from "@/app/features/setup/workflow";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import {
  creationBehavior,
  firstChatAdmission,
  visibleSessions,
} from "@/app/features/ui-policy/policy";
import { routes } from "@/app/lib/routes";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  useCreateModelConfig,
  useCreateSession,
  useSandboxActivity,
  useSessions,
} from "@/app/services/queries";
import type { BackendKind, CreateSessionRequest, SessionBehavior } from "@/app/types/api";

import {
  configuredSessionRequest,
  overrideLight,
  type ModelOverride,
  type ResolvedModel,
} from "./modelChoice";
import { sandboxRequest, type SandboxOptions } from "./workspaceSandbox";

export interface StartRequest {
  projectId: string;
  behavior: SessionBehavior;
  prompt: string;
  /** Null: the server inherits the project's model, as for any plain create. */
  model: ModelOverride | null;
  sandbox?: SandboxOptions;
}

/**
 * Home's send: create the session (inheriting, or with the composer's model
 * override), deliver the prompt as its first message, then open it.
 *
 * The runtime-only first-message intent is consumed by the owning composer
 * after its interactive stream is live. Reload/replacement retains text only,
 * never an executable intent.
 */
export function useStartSession() {
  const navigate = useNavigate();
  const policy = useUiPolicy();
  const client = useQueryClient();
  const action = useSetupAction();
  const createSession = useCreateSession();
  const createModelConfig = useCreateModelConfig();
  const { data: allSessions = [] } = useSessions();
  const [sandboxActivityKey, setSandboxActivityKey] = useState<string | null>(null);
  const sandboxActivity = useSandboxActivity(sandboxActivityKey);

  /**
   * A project's first primary session keeps the server's first-chat
   * convergence: concurrent starts in an empty project land in one session.
   * Hidden legacy sessions still count against admission, as before.
   */
  const firstChat = (projectId: string) => {
    const visible = visibleSessions(policy, allSessions);
    const empty = !visible.some(
      (entry) => entry.lineage == null && entry.summary.project_id === projectId,
    );
    return {
      first_chat: empty && firstChatAdmission(policy, allSessions, projectId),
      first_chat_same_behavior: !policy.orchestrationEnabled,
    };
  };
  const { stores } = useNativeRuntime();
  const { update: updateDraft } = stores.promptDraftStore;
  const [error, setError] = useState<string | null>(null);

  const createChat = async (body: CreateSessionRequest, sandbox?: SandboxOptions) => {
    const activityKey = sandbox ? crypto.randomUUID() : null;
    if (activityKey) setSandboxActivityKey(activityKey);
    try {
      const snapshot = await createSession.mutateAsync(
        sandbox && activityKey
          ? {
              ...body,
              // First-chat reuse can return an existing Local or SSH session.
              first_chat: false,
              sandbox: sandboxRequest(sandbox, activityKey),
            }
          : body,
      );
      return snapshot.metadata.session_id ?? null;
    } finally {
      if (activityKey) setSandboxActivityKey(null);
    }
  };

  const createWithOverride = (
    request: StartRequest,
    override: ModelOverride,
    current: () => boolean,
  ) => {
    return createConfiguredChat({
      current,
      classify: classifySetupFailure,
      reconcile: setupReconciliation(client),
      persistsModel: override.selection.kind === "save",
      model: async (): Promise<ResolvedModel> => {
        const selection = override.selection;
        if (selection.kind !== "save") return selection;
        const record = await createModelConfig.mutateAsync({
          ...selection.request,
          light_model: policy.orchestrationEnabled
            ? override.light.mode === "dual"
              ? override.light.light
              : null
            : (override.selectedLight ?? null),
        });
        return {
          // SAFETY: the server echoes the BackendKind wire value it stored.
          backend: record.backend as BackendKind,
          model: record.model,
          base_url: record.base_url,
          allow_insecure_http: record.allow_insecure_http ?? false,
          api_key_env: record.api_key_env ?? null,
          reasoning_effort: record.reasoning_effort ?? null,
          ...(selection.request.service_tier === null
            ? { service_tier: null }
            : record.service_tier != null
              ? { service_tier: record.service_tier as ServiceTier }
              : {}),
          extra_headers: record.extra_headers,
          orchestrator_compaction_threshold: record.orchestrator_compaction_threshold ?? null,
        };
      },
      chat: (selected) =>
        createChat(
          {
            ...configuredSessionRequest({
              policy,
              projectId: request.projectId,
              behavior: request.behavior,
              selected,
              light: overrideLight(policy, override, selected),
            }),
            ...firstChat(request.projectId),
          },
          request.sandbox,
        ),
    });
  };

  const createPlain = (request: StartRequest) =>
    createChat(
      {
        project_id: request.projectId,
        behavior: creationBehavior(policy, request.behavior),
        ...firstChat(request.projectId),
      },
      request.sandbox,
    );

  /** Opens an empty session (no prompt typed): the composer there takes over. */
  const start = async (request: StartRequest): Promise<boolean> => {
    if (action.busy || action.needsReview) return false;
    setError(null);
    try {
      const sessionId = await action.run((lease) => {
        const ports = {
          current: lease.current,
          classify: classifySetupFailure,
          reconcile: setupReconciliation(client),
        };
        const creation = request.model
          ? createWithOverride(request, request.model, lease.current)
          : setupSequence(ports, (step) => step("chat", () => createPlain(request)));
        return creation;
      });
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
