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
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { creationBehavior } from "@/app/features/ui-policy/policy";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { useToast } from "@/app/providers/ToastProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { useCreateModelConfig, useCreateSession, useSubmitRun } from "@/app/services/queries";
import type { BackendKind, SessionBehavior } from "@/app/types/api";

import {
  configuredSessionRequest,
  overrideLight,
  type ModelOverride,
  type ResolvedModel,
} from "./modelChoice";

export interface StartRequest {
  projectId: string;
  behavior: SessionBehavior;
  prompt: string;
  /** Null: the server inherits the project's model, as for any plain create. */
  model: ModelOverride | null;
}

/**
 * Home's send: create the session (inheriting, or with the composer's model
 * override), deliver the prompt as its first message, then open it.
 *
 * Delivery never replays: a rejected first message is put back in the new
 * session's composer; an uncertain one is reported so the user checks before
 * resending.
 */
export function useStartSession() {
  const navigate = useNavigate();
  const toast = useToast();
  const policy = useUiPolicy();
  const client = useQueryClient();
  const action = useSetupAction();
  const createSession = useCreateSession();
  const createModelConfig = useCreateModelConfig();
  const submitRun = useSubmitRun();
  const { update: updateDraft } = useNativeRuntime().stores.promptDraftStore;
  const [error, setError] = useState<string | null>(null);
  const [plainBusy, setPlainBusy] = useState(false);

  const createWithOverride = async (request: StartRequest, override: ModelOverride) => {
    const result = await action.run((lease) =>
      createConfiguredChat({
        current: lease.current,
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
            extra_headers: record.extra_headers,
            orchestrator_compaction_threshold: record.orchestrator_compaction_threshold ?? null,
          };
        },
        chat: async (selected) => {
          const snapshot = await createSession.mutateAsync(
            configuredSessionRequest({
              policy,
              projectId: request.projectId,
              behavior: request.behavior,
              selected,
              light: overrideLight(policy, override, selected),
            }),
          );
          return snapshot.metadata.session_id ?? null;
        },
      }),
    );
    return result ?? null;
  };

  const createPlain = async (request: StartRequest) => {
    const snapshot = await createSession.mutateAsync({
      project_id: request.projectId,
      behavior: creationBehavior(policy, request.behavior),
    });
    return snapshot.metadata.session_id ?? null;
  };

  const deliver = async (sessionId: string, prompt: string) => {
    try {
      await submitRun.mutateAsync({ id: sessionId, prompt });
    } catch (cause) {
      if (cause instanceof UncertainCommandAdmissionError) {
        toast.error(
          "The session started, but your first message could not be confirmed. Check the conversation before sending it again.",
        );
        return;
      }
      updateDraft(sessionId, prompt);
      toast.error(
        `The session started, but your first message was not sent: ${humanErrorText(toRunError(cause))}. It is waiting in the composer.`,
      );
    }
  };

  /** Opens an empty session (no prompt typed): the composer there takes over. */
  const start = async (request: StartRequest): Promise<boolean> => {
    if (action.busy || plainBusy || action.needsReview) return false;
    setError(null);
    try {
      let sessionId: string | null;
      if (request.model) {
        sessionId = await createWithOverride(request, request.model);
      } else {
        setPlainBusy(true);
        try {
          sessionId = await createPlain(request);
        } finally {
          setPlainBusy(false);
        }
      }
      if (!sessionId) return false;
      if (request.prompt.trim()) await deliver(sessionId, request.prompt);
      navigate(routes.session(sessionId));
      return true;
    } catch (cause) {
      setError(
        request.model
          ? setupFailureMessage(cause)
          : `Couldn't start the session: ${humanErrorText(toRunError(cause))}`,
      );
      return false;
    }
  };

  return {
    start,
    busy: action.busy || plainBusy || submitRun.isPending,
    /** An uncertain configured create needs a fresh review (reload) before retrying. */
    needsReview: action.needsReview,
    error,
    clearError: () => setError(null),
  };
}
