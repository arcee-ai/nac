import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import {
  creationBehavior,
  visibleSessions,
  firstChatAdmission,
} from "@/app/features/ui-policy/policy";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { Button, ButtonVariant, Loader, LoaderSize, Modal, ModalSize } from "@/app/atoms";
import {
  type ConfigurationsPanelInitial,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { LightModelSection, type LightSelection } from "@/app/components/modals/LightModelSection";
import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import { createConfiguredChat } from "@/app/features/setup/workflow";
import {
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import { SessionBehaviorPicker } from "@/app/components/modals/SessionBehaviorPicker";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { inheritPrimaryCredential } from "@/app/lib/modelConfig";
import {
  newestCreatedPrimarySessionForProject,
  newestPrimarySessionForProject,
} from "@/app/lib/projects";
import { routes } from "@/app/lib/routes";

import {
  useCreateModelConfig,
  useCreateSession,
  useModelConfigs,
  useProjects,
  useSessionConfig,
  useSessions,
} from "@/app/services/queries";
import type {
  BackendKind,
  CreateSessionRequest,
  LightModelSettings,
  ModelConfigurationRecord,
  RawSessionConfig,
  SessionBehavior,
} from "@/app/types/api";

interface InheritedModelSelection {
  initial: ConfigurationsPanelInitial;
  light: LightModelSettings | null;
}

function parseHeaders(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (Object(parsed) !== parsed || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function fromSavedConfiguration(record: ModelConfigurationRecord): InheritedModelSelection {
  return {
    initial: {
      // SAFETY: model configurations are created through the backend's typed
      // BackendKind request even though the stored compatibility record is a string.
      backend: record.backend as BackendKind,
      model: record.model,
      base_url: record.base_url,
      allow_insecure_http: record.allow_insecure_http,
      api_key_env: record.api_key_env ?? null,
      reasoning_effort: record.reasoning_effort ?? null,
      extra_headers: record.extra_headers,
      orchestrator_compaction_threshold: record.orchestrator_compaction_threshold,
      light_model: record.light_model ?? null,
      config_id: record.config_id,
    },
    light: record.light_model ?? null,
  };
}

function fromSessionConfiguration(
  config: RawSessionConfig,
  summaryBackend: string,
): InheritedModelSelection {
  return {
    initial: {
      // SAFETY: both values originate from the server's validated BackendKind
      // persistence path; the raw compatibility projection permits null/string.
      backend: (config.backend ?? summaryBackend) as BackendKind,
      model: config.model,
      base_url: config.base_url,
      allow_insecure_http: config.allow_insecure_http,
      api_key_env: config.api_key_env ?? null,
      reasoning_effort: config.reasoning_effort ?? null,
      extra_headers: parseHeaders(config.extra_headers_json),
      orchestrator_compaction_threshold: config.orchestrator_compaction_threshold,
      light_model: config.light_model ?? null,
    },
    light: config.light_model ?? null,
  };
}

export function NewChatModal({
  projectId,
  firstChat = false,
  onClose,
}: {
  projectId: string | null;
  firstChat?: boolean;
  onClose: () => void;
}) {
  const mounted = useExitTransition(projectId !== null);
  if (!mounted || projectId === null) return null;
  return (
    <NewChatForm key={projectId} projectId={projectId} firstChat={firstChat} onClose={onClose} />
  );
}

function NewChatForm({
  projectId,
  firstChat,
  onClose,
}: {
  projectId: string;
  firstChat: boolean;
  onClose: () => void;
}) {
  const { api } = useNativeRuntime();

  const navigate = useNavigate();
  const action = useSetupAction();
  const client = useQueryClient();
  const createSession = useCreateSession();
  const createModelConfig = useCreateModelConfig();
  const projects = useProjects();
  const sessions = useSessions();
  const modelConfigs = useModelConfigs();
  const policy = useUiPolicy();
  const [behavior, setBehavior] = useState<SessionBehavior>(
    policy.orchestrationEnabled ? "orchestrator" : "direct",
  );
  const [selection, setSelection] = useState<LaunchModelSelection | null>(null);
  const [light, setLight] = useState<LightSelection>({ mode: "single", light: null });
  const [error, setError] = useState("");

  const project = projects.data?.projects.find((entry) => entry.project_id === projectId) ?? null;
  const sibling = newestCreatedPrimarySessionForProject(sessions.data ?? [], projectId);
  const defaultConfig = project?.default_model_config_id
    ? (modelConfigs.data?.configurations.find(
        (record) => record.config_id === project.default_model_config_id,
      ) ?? null)
    : null;
  const siblingConfig = useSessionConfig(
    project?.default_model_config_id ? null : (sibling?.summary.session_id ?? null),
  );
  const inherited = useMemo<InheritedModelSelection | null>(() => {
    if (defaultConfig) return fromSavedConfiguration(defaultConfig);
    if (siblingConfig.data && sibling) {
      return fromSessionConfiguration(siblingConfig.data, sibling.summary.backend);
    }
    return null;
  }, [defaultConfig, siblingConfig.data, sibling]);
  const inheritancePending =
    projects.isPending ||
    sessions.isPending ||
    modelConfigs.isPending ||
    (Boolean(sibling) && !project?.default_model_config_id && siblingConfig.isPending);
  const inheritanceError =
    projects.error ||
    sessions.error ||
    siblingConfig.error ||
    (project?.default_model_config_id &&
      (modelConfigs.error || (!modelConfigs.isPending && !defaultConfig)
        ? new Error(
            "The project default is unavailable. Review the project settings before creating a chat.",
          )
        : null));
  const busy = action.busy;

  const onSelection = useCallback((next: LaunchModelSelection | null) => {
    setSelection(next);
    setError((current) =>
      /refresh and review|reopen setup|outcome is unknown/i.test(current) ? current : "",
    );
  }, []);

  const onLight = useCallback((next: LightSelection) => {
    setLight(next);
    setError((current) =>
      /refresh and review|reopen setup|outcome is unknown/i.test(current) ? current : "",
    );
  }, []);

  // A saved setup selected inside the primary picker owns its light-model
  // default. Catalog/file selections carry no opinion, so they preserve the
  // project's effective inherited choice until the user changes it.
  const selectedLight =
    selection?.kind === "resolved" && selection.light_model !== undefined
      ? selection.light_model
      : inherited?.light;
  const selectedLightKey = JSON.stringify(selectedLight);

  const submit = async () => {
    if (busy || action.needsReview || inheritancePending || Boolean(inheritanceError)) return;
    if (!selection) {
      setError("Choose the primary model before creating this chat.");
      return;
    }
    if (policy.orchestrationEnabled && light.mode === "dual" && !light.light) {
      setError("Pick the light model before creating this chat.");
      return;
    }
    try {
      const destination = await action.run((current) =>
        createConfiguredChat({
          current: current.current,
          classify: classifySetupFailure,
          reconcile: setupReconciliation(client),
          existing: firstChat
            ? async () => {
                const [projects, sessions] = await Promise.all([
                  api.listProjects(current.signal),
                  api.listSessions({ projectId }, current.signal),
                ]);
                if (!projects.projects.some((project) => project.project_id === projectId))
                  return routes.list();
                const existing = newestPrimarySessionForProject(
                  visibleSessions(policy, sessions),
                  projectId,
                );
                return existing ? routes.session(existing.summary.session_id) : null;
              }
            : undefined,
          persistsModel: selection.kind === "save",
          model: async () => {
            let selected: {
              backend: BackendKind;
              model: string;
              base_url: string;
              allow_insecure_http: boolean;
              api_key_env: string | null;
              reasoning_effort: string | null;
              extra_headers: Record<string, string> | null;
              orchestrator_compaction_threshold?: number | null;
            };
            if (selection.kind === "save") {
              const record = await createModelConfig.mutateAsync({
                ...selection.request,
                light_model: policy.orchestrationEnabled
                  ? light.mode === "dual"
                    ? light.light
                    : null
                  : (selectedLight ?? null),
              });
              if (current.current())
                setSelection({
                  kind: "resolved",
                  ...record,
                  backend: record.backend as BackendKind,
                  api_key_env: record.api_key_env ?? null,
                  reasoning_effort: record.reasoning_effort ?? null,
                  light_model: record.light_model ?? null,
                });
              selected = {
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
            } else {
              selected = selection;
            }

            return selected;
          },
          chat: async (selected) => {
            const finalLight = !policy.orchestrationEnabled
              ? (selectedLight ?? null)
              : light.mode === "dual" && light.light
                ? inheritPrimaryCredential(light.light, selected.backend, selected.api_key_env)
                : null;
            const request: CreateSessionRequest = {
              project_id: projectId,
              behavior: creationBehavior(policy, behavior),
              first_chat: firstChat && firstChatAdmission(policy, sessions.data ?? [], projectId),
              first_chat_same_behavior: !policy.orchestrationEnabled,
              backend: selected.backend,
              model: selected.model,
              base_url: selected.base_url,
              allow_insecure_http: selected.allow_insecure_http,
              api_key_env: selected.api_key_env,
              reasoning_effort: selected.reasoning_effort,
              extra_headers: selected.extra_headers,
              // Explicit null matters: it lets a user turn an inherited dual-model
              // project default into a single-model chat without changing the project.
              light_model: finalLight,
            };
            if (selected.orchestrator_compaction_threshold !== undefined) {
              request.orchestrator_compaction_threshold =
                selected.orchestrator_compaction_threshold;
            }
            const snapshot = await createSession.mutateAsync(request);
            return snapshot.metadata.session_id
              ? routes.session(snapshot.metadata.session_id)
              : routes.project(projectId);
          },
        }),
      );
      if (destination) {
        onClose();
        navigate(destination, { replace: firstChat });
      }
    } catch (error) {
      setError(setupFailureMessage(error));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size={ModalSize.Wide}
      flush
      className="h-[700px]"
      title="New Chat"
      subheader={
        policy.orchestrationEnabled
          ? "Choose this chat's behavior and models. These settings apply to this chat without changing the project default."
          : "Choose this chat's model. These settings apply to this chat without changing the project default."
      }
      footer={
        <Button
          variant={ButtonVariant.Primary}
          loading={busy}
          disabled={
            busy ||
            action.needsReview ||
            inheritancePending ||
            Boolean(inheritanceError) ||
            !selection
          }
          onClick={() => void submit()}
        >
          Create chat
        </Button>
      }
    >
      {policy.orchestrationEnabled ? (
        <SessionBehaviorPicker value={behavior} onChange={setBehavior} disabled={busy} />
      ) : null}
      {inheritanceError ? (
        <p role="alert" className="text-micro text-error-primary">
          The inherited settings could not be loaded. Reopen New Chat to refresh and review them.
        </p>
      ) : inheritancePending ? (
        <div className="flex items-center gap-2 py-6 text-micro text-basic-muted" role="status">
          <Loader size={LoaderSize.Micro} />
          Loading the project's model settings…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-micro text-basic-muted">
            {defaultConfig
              ? "Inherited from the project default"
              : inherited
                ? "Inherited from the latest chat"
                : "No saved project model default"}
            {inherited
              ? `: ${inherited.initial.model} · ${inherited.initial.backend} · reasoning ${inherited.initial.reasoning_effort ?? "model default"}.`
              : "."}{" "}
            Changes below override this chat only.
          </p>
          <ModelSetupSection
            initial={inherited?.initial}
            onChange={onSelection}
            invalid={Boolean(error)}
            errorText={error || undefined}
          />
          {policy.orchestrationEnabled ? (
            <LightModelSection
              key={selectedLightKey}
              initial={selectedLight}
              behavior={behavior}
              onChange={onLight}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
