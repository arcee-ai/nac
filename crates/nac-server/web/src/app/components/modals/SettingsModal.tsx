import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Modal,
  ModalSize,
  Separator,
  StickyButton,
  TextArea,
  TextAreaSize,
} from "@/app/atoms";
import { SshBadge } from "@/app/components/SshBadge";
import { type LaunchModelSelection } from "@/app/components/modals/ConfigurationsPanel";
import { ConfigRow, CONTROL_WIDTH } from "@/app/components/modals/ConfigRow";
import { LightModelSection, type LightSelection } from "@/app/components/modals/LightModelSection";
import { reasoningOptionsFor } from "@/app/components/modals/options";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { matchesManagedModelPick } from "@/app/features/managed/model";
import { useManagedHostStatus } from "@/app/features/managed/queries";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import {
  inheritPrimaryCredential,
  buildSettingsPatch,
  managedLaunchBaseUrl,
  sameLightModel,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";
import { savedModelSelection, sameModelSelection } from "@/app/features/setup/modelSelection";
import { saveSettings } from "@/app/features/setup/workflow";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import {
  ConfigurationChanged,
  SetupValidation,
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import {
  useCreateModelConfig,
  useModelCatalog,
  useSessionConfig,
  useSessionSummary,
  useUpdateConfig,
  useUpdatePresentation,
  useUpdateProject,
} from "@/app/services/queries";
import { sshTargetFromSummary, useSshConnectionStatus } from "@/app/store/sshConnectionStore";
import type {
  BackendKind,
  LightModelSettings,
  RawSessionConfig,
  SessionSummarySnapshot,
  SshTarget,
} from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

function headersToText(headers: Record<string, string>): string {
  return Object.keys(headers).length === 0 ? "" : JSON.stringify(headers, null, 2);
}

/** The persisted column is a JSON string; unparsable content means "repair me". */
function parseHeadersJson(json: string | null | undefined): {
  headers: Record<string, string>;
  invalid: boolean;
} {
  if (!json) return { headers: {}, invalid: false };
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      Object(parsed) !== parsed ||
      Array.isArray(parsed) ||
      Object.values(parsed as Record<string, unknown>).some((value) => typeof value !== "string")
    ) {
      return { headers: {}, invalid: true };
    }
    // SAFETY: the checks above admit only a non-null object with string values.
    return { headers: parsed as Record<string, string>, invalid: false };
  } catch {
    return { headers: {}, invalid: true };
  }
}

function initialFromConfig(config: RawSessionConfig): SettingsInitialValues {
  const headers = parseHeadersJson(config.extra_headers_json);
  return {
    model: config.model,
    backend: config.backend ?? "",
    base_url: config.base_url,
    allow_insecure_http: config.allow_insecure_http ?? false,
    reasoning_effort: config.reasoning_effort || null,
    api_key_env: config.api_key_env || null,
    extra_headers: headers.headers,
    extra_headers_invalid: headers.invalid,
    orchestrator_compaction_threshold: config.orchestrator_compaction_threshold,
  };
}

/** Shared chrome, so the loading state does not resize into the loaded form. */
function SettingsShell({
  open,
  onClose,
  footer,
  titleExtra,
  children,
}: {
  open: boolean;
  onClose: () => void;
  footer?: React.ReactNode;
  titleExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        titleExtra ? (
          <div className="flex items-center gap-4">
            <span className="flex-1 min-w-0">Session settings</span>
            {titleExtra}
          </div>
        ) : (
          "Session settings"
        )
      }
      size={ModalSize.Wide}
      flush
      className="h-[700px]"
      footer={footer}
    >
      {children}
    </Modal>
  );
}

export function SettingsModal({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  // Keyed on `mounted` rather than `open`: dropping the queries the moment the
  // dialog starts closing would blank the form out mid-slide.
  const mounted = useExitTransition(open);
  const { data: entry, isLoading: isSummaryLoading } = useSessionSummary(mounted ? id : null);
  // Fetched for diagnostics ("repair required") and as a fallback source when
  // the live snapshot is unavailable.
  const { data: config, isLoading } = useSessionConfig(mounted ? id : null);

  if (!mounted || !id) return null;

  const initial = config ? initialFromConfig(config) : null;

  // The form seeds its light-model state from `config` once at mount, so it
  // must not mount before /config settles — a light model arriving later
  // would leave the form on Single and a save would clear dual mode.
  if (!initial || !entry || isLoading) {
    return (
      <SettingsShell open={open} onClose={onClose}>
        <p className="text-basic-muted text-micro">
          {isLoading || isSummaryLoading
            ? "Loading session configuration…"
            : "Session configuration unavailable."}
        </p>
      </SettingsShell>
    );
  }

  return (
    <SettingsForm
      key={`${id}:${open ? "open" : "closing"}`}
      initialVersion={config?.config_version}
      open={open}
      id={id}
      initial={initial}
      initialLight={config?.light_model ?? null}
      summary={entry.summary}
      diagnostics={config?.diagnostics ?? []}
      onClose={onClose}
    />
  );
}

/** Mounted only once the initial values are known, so the form owns its state. */
function SettingsForm({
  open,
  id,
  initial,
  initialLight,
  initialVersion,
  summary,
  diagnostics,
  onClose,
}: {
  open: boolean;
  id: string;
  initial: SettingsInitialValues;
  initialVersion?: number;
  /** The light model the session currently runs with, if any. */
  initialLight: LightModelSettings | null;
  /** Carries the presentation version the title save has to match. */
  summary: SessionSummarySnapshot;
  diagnostics: string[];
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const client = useQueryClient();
  const action = useSetupAction(open);
  const sessionTitle = useSessionTitle();
  const updateConfig = useUpdateConfig();
  const updateProject = useUpdateProject();
  const [updateProjectDefault, setUpdateProjectDefault] = useState(false);
  const managedHostQuery = useManagedHostStatus();
  const managedHost = managedHostQuery.data ?? null;
  const createModelConfig = useCreateModelConfig();
  const policy = useUiPolicy();
  const [openingSummary] = useState(summary);
  const [openingVersion] = useState(initialVersion);
  const updatePresentation = useUpdatePresentation();

  const initialTitle = openingSummary.title ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [model, setModel] = useState(initial.model);
  const [backend, setBackend] = useState(initial.backend);
  const [reasoning, setReasoning] = useState(initial.reasoning_effort ?? "");
  const [, setBaseUrl] = useState(initial.base_url);
  const [headers, setHeaders] = useState(headersToText(initial.extra_headers));
  const [compaction, setCompaction] = useState(
    initial.orchestrator_compaction_threshold != null
      ? String(initial.orchestrator_compaction_threshold)
      : "",
  );
  // Track whether the compaction value was auto-suggested (vs. user-entered)
  // so model changes don't clobber a manual value. The ref mirrors the state
  // so the auto-suggest effect can read it without depending on the state.
  const compactionRef = useRef(
    initial.orchestrator_compaction_threshold != null
      ? String(initial.orchestrator_compaction_threshold)
      : "",
  );
  // A persisted null is disabled, not an invitation to change it on mount.
  const compactionAutoRef = useRef(false);
  // An explicitly selected saved preset owns even a disabled (`null`)
  // compaction policy. Keep an empty explicit value from being replaced by
  // the catalog's automatic 70% suggestion until the user edits it.
  const compactionPresetRef = useRef(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<LaunchModelSelection | null>(null);
  const [light, setLight] = useState<LightSelection>({
    mode: initialLight ? "dual" : "single",
    light: initialLight,
  });
  const [lightSeed, setLightSeed] = useState(initialLight);
  const [advanced, setAdvanced] = useState(false);
  const [clearMalformedLight, setClearMalformedLight] = useState(false);

  // A malformed stored light model loads as null with only a diagnostic; the
  // server then refuses patches that omit light_model, so saving must always
  // send an explicit repair or clear.
  const lightNeedsRepair = diagnostics.some((diagnostic) =>
    diagnostic.startsWith("malformed stored light model"),
  );

  const projectedSelection = useRef<LaunchModelSelection | null>(null);
  const onConfigurationChange = useCallback(
    (next: LaunchModelSelection | null, source: "primary" | "preset") => {
      setSelection(next);
      if (!next || sameModelSelection(projectedSelection.current, next)) return;
      const previous = projectedSelection.current;
      projectedSelection.current = next;
      const values = next.kind === "resolved" ? next : next.request;
      setBackend(values.backend);
      setModel(values.model);
      setBaseUrl(values.base_url ?? managedLaunchBaseUrl(values.backend) ?? "");
      if (next.kind === "resolved") {
        setReasoning(next.reasoning_effort ?? "");
        const primaryChange = source === "primary" && previous?.kind === "resolved";
        const sameProviderRoute =
          primaryChange &&
          previous.backend === next.backend &&
          previous.base_url === next.base_url &&
          previous.api_key_env === next.api_key_env &&
          previous.allow_insecure_http === next.allow_insecure_http;
        // Primary identity changes leave execution drafts with their local form
        // owner. A provider/account transition still clears the prior headers.
        // Explicit preset selection intentionally projects the complete tuple.
        if (!sameProviderRoute) setHeaders(headersToText(next.extra_headers ?? {}));
        if (primaryChange) return;
        if (next.orchestrator_compaction_threshold !== undefined) {
          const threshold = next.orchestrator_compaction_threshold;
          const value = threshold == null ? "" : String(threshold);
          compactionPresetRef.current = true;
          compactionAutoRef.current = false;
          compactionRef.current = value;
          setCompaction(value);
        } else {
          const leavingPreset = compactionPresetRef.current;
          compactionPresetRef.current = false;
          if (leavingPreset) {
            compactionAutoRef.current = true;
            compactionRef.current = "";
            setCompaction("");
          }
        }
        if (next.light_model !== undefined) {
          setLightSeed(next.light_model);
          setLight({
            mode: next.light_model ? "dual" : "single",
            light: next.light_model,
          });
        }
      }
    },
    [],
  );

  // Only the levels this model actually accepts: the backend rejects the rest,
  // so offering them would only produce a save that fails.
  const catalog = useModelCatalog();
  const reasoningItems = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, backend, model).supportedEfforts,
    reasoning,
  );

  const compactionPlaceholder = useMemo(() => {
    const resolved = resolveCatalogModel(catalog.data, backend, model);
    const contextWindow = resolved.contextWindow;
    return contextWindow ? String(Math.round(contextWindow * 0.7)) : "auto";
  }, [catalog.data, backend, model]);

  // Auto-suggest 70% of the selected model's context window as the compaction
  // threshold. A manually entered value is preserved across model changes —
  // the suggestion only fills the field when it is empty or was itself last
  // auto-suggested.
  useEffect(() => {
    if (
      !compactionPresetRef.current &&
      compactionPlaceholder !== "auto" &&
      compactionAutoRef.current
    ) {
      compactionAutoRef.current = true;
      compactionRef.current = compactionPlaceholder;
      setCompaction(compactionPlaceholder);
    }
  }, [compactionPlaceholder, selection]);

  const blocked = !selection || action.needsReview || action.busy;
  const busy =
    action.busy ||
    managedHostQuery.isPending ||
    updateConfig.isPending ||
    updatePresentation.isPending ||
    createModelConfig.isPending;

  const seedTarget = sshTargetFromSummary(openingSummary);
  const sshStatus = useSshConnectionStatus(seedTarget);
  // Null means "follow the shared store"; a concrete value is the user's last
  // Connect/Disconnect action in this dialog.
  const [sshConnection, setSshConnection] = useState<SshTarget | null | undefined>(undefined);
  const connectedTarget =
    sshConnection === undefined ? (sshStatus === "connected" ? seedTarget : null) : sshConnection;

  const onSshConnectionChange = (target: SshTarget | null) => {
    setSshConnection(target);
  };

  const saveTitle = () =>
    updatePresentation.mutateAsync({
      id,
      title: title.trim(),
      pinned: Boolean(openingSummary.pinned),
      expectedVersion: openingSummary.presentation_version ?? 0,
    });

  const patchFor = (selected: {
    backend: BackendKind;
    model: string;
    base_url: string;
    allow_insecure_http: boolean;
    api_key_env: string | null;
  }) => {
    let patch;
    try {
      const allowsCredentiallessSelection = Boolean(
        managedHost?.model_ready &&
        matchesManagedModelPick(managedHost, {
          backend: selected.backend,
          model: selected.model,
          baseUrl: selected.base_url,
        }),
      );
      patch = buildSettingsPatch(
        {
          model: selected.model,
          backend: selected.backend,
          base_url: selected.base_url,
          allow_insecure_http: selected.allow_insecure_http,
          reasoning_effort: reasoning,
          credential_mode: selected.api_key_env ? "variable" : "none",
          api_key_env: selected.api_key_env ?? "",
          extra_headers: headers,
          orchestrator_compaction_threshold: compaction,
        },
        initial,
        allowsCredentiallessSelection,
      );
    } catch (validationError) {
      throw new SetupValidation(
        validationError instanceof Error ? validationError.message : String(validationError),
      );
    }
    if (policy.orchestrationEnabled) {
      if (light.mode === "dual") {
        // Guarded before a named configuration can be created above.
        if (!light.light) throw new SetupValidation("Pick the light model before saving.");
        const finalLight = inheritPrimaryCredential(
          light.light,
          selected.backend,
          selected.api_key_env,
          initial.api_key_env,
        );
        if (lightNeedsRepair || !sameLightModel(finalLight, initialLight)) {
          patch.light_model = finalLight;
        }
      } else if (initialLight || lightNeedsRepair) {
        patch.light_model = null;
      }
    } else if (clearMalformedLight) {
      patch.light_model = null;
    } else if (!sameLightModel(light.light, initialLight)) {
      // Explicit preset selection still reproduces its complete tuple. Hiding
      // the control alone leaves the raw existing value untouched.
      patch.light_model = light.light;
    }
    return patch;
  };

  const submit = async () => {
    if (busy || action.needsReview || !selection) return;
    if (updateProjectDefault && selection.kind === "resolved" && !selection.config_id) {
      setError("Choose a saved preset in Advanced before updating the project default.");
      return;
    }
    if (policy.orchestrationEnabled && light.mode === "dual" && !light.light) {
      setError("Pick the light model before saving.");
      return;
    }

    let configurationChanged = false;
    try {
      const values = selection.kind === "save" ? selection.request : selection;
      const preview = patchFor({
        ...values,
        base_url: values.base_url ?? managedLaunchBaseUrl(values.backend) ?? "",
        allow_insecure_http: values.allow_insecure_http ?? false,
        api_key_env:
          selection.kind === "resolved"
            ? selection.api_key_env
            : selection.request.api_key
              ? "PENDING_SAVED_CREDENTIAL"
              : null,
      });
      configurationChanged = selection.kind === "save" || Object.keys(preview).length > 0;
    } catch (validationError) {
      setError(setupFailureMessage(validationError));
      return;
    }
    try {
      const result = await action.run((current) =>
        saveSettings({
          current: current.current,
          classify: classifySetupFailure,
          reconcile: setupReconciliation(client, id),
          check: async () => {
            const latest = await api.getConfig(id, current.signal);
            if (openingVersion !== undefined && latest.config_version !== openingVersion)
              throw new ConfigurationChanged();
          },
          persistsModel: selection.kind === "save",
          model: async () => {
            if (selection.kind === "save") {
              const record = await createModelConfig.mutateAsync({
                ...selection.request,
                light_model: light.mode === "dual" ? light.light : null,
              });
              const selected = savedModelSelection(record);
              if (current.current()) setSelection(selected);
              return selected;
            }
            return selection;
          },
          configurationSaved: configurationChanged,
          configuration: async (selected) => {
            const patch = patchFor(selected);

            if (Object.keys(patch).length > 0) await updateConfig.mutateAsync({ id, patch });
          },
          title: title.trim() !== initialTitle.trim() ? saveTitle : undefined,
          projectDefault:
            updateProjectDefault && openingSummary.project_id
              ? (selected) => {
                  if (!selected.config_id)
                    throw new SetupValidation(
                      "Choose a saved preset before updating the project default.",
                    );
                  return updateProject.mutateAsync({
                    projectId: openingSummary.project_id!,
                    payload: { default_model_config_id: selected.config_id },
                  });
                }
              : undefined,
        }),
      );
      if (!result) return;
      toast.success("Session settings saved");
      onClose();
    } catch (saveError) {
      setError(setupFailureMessage(saveError));
    }
  };

  const footer = (
    <>
      {isMobile ? (
        <StickyButton
          variant={ButtonVariant.Tertiary}
          content={ButtonContent.Text}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </StickyButton>
      ) : (
        <Button
          variant={ButtonVariant.Tertiary}
          size={ButtonSize.Large}
          content={ButtonContent.Text}
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
      )}
      {isMobile ? (
        <StickyButton
          variant={ButtonVariant.Primary}
          aria-label="Save"
          content={ButtonContent.Text}
          onClick={submit}
          disabled={blocked}
          loading={busy}
        >
          Save
        </StickyButton>
      ) : (
        <Button
          variant={ButtonVariant.Primary}
          aria-label="Save"
          size={ButtonSize.Large}
          content={ButtonContent.Text}
          onClick={submit}
          disabled={blocked}
          loading={busy}
        >
          Save
        </Button>
      )}
    </>
  );

  return (
    <SettingsShell
      open={open}
      onClose={onClose}
      footer={footer}
      titleExtra={
        seedTarget ? (
          <SshBadge state={sshStatus === "connected" ? "connected" : "disconnected"} />
        ) : null
      }
    >
      <div className="flex flex-col gap-6 [&>*]:shrink-0">
        <p className="text-micro text-basic-muted">
          Changes apply to this inactive primary chat. Project defaults and existing children keep
          their settings.
        </p>
        {diagnostics.length > 0 ? (
          <div className="rounded-[4px] border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary">
            <div className="label-small mb-1">Repair required</div>
            {diagnostics.map((diagnostic) => (
              <div key={diagnostic}>• {diagnostic}</div>
            ))}
          </div>
        ) : null}

        {seedTarget ? (
          <>
            <SshConnectionBox
              mode="settings"
              connection={connectedTarget}
              seedTarget={seedTarget}
              onConnectionChange={onSshConnectionChange}
            />
            <Separator />
          </>
        ) : null}

        <Input
          label="Session title"
          aria-label="Session title"
          inputSize={isMobile ? InputSize.Large : InputSize.Medium}
          placeholder={sessionTitle(openingSummary) || "Session name"}
          hintText="Leave empty to restore the automatic title (the last prompt)."
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <ModelSetupSection
          existingSession
          simple={!policy.orchestrationEnabled}
          invalid={Boolean(error)}
          errorText={error || undefined}
          initial={{
            // SAFETY: the metadata backend is one of the BackendKind wire
            // values the server stores.
            backend: initial.backend as BackendKind,
            model: initial.model,
            base_url: initial.base_url,
            allow_insecure_http: initial.allow_insecure_http,
            api_key_env: initial.api_key_env,
            reasoning_effort: initial.reasoning_effort,
            extra_headers: initial.extra_headers,
            orchestrator_compaction_threshold: initial.orchestrator_compaction_threshold,
            light_model: initialLight,
          }}
          onChange={onConfigurationChange}
        >
          <div className="flex flex-col gap-2">
            {policy.orchestrationEnabled ? (
              <LightModelSection
                key={JSON.stringify(lightSeed)}
                initial={light.light}
                behavior={openingSummary.behavior ?? "orchestrator"}
                onChange={setLight}
              />
            ) : null}
            {openingSummary.project_id ? (
              <label className="flex items-start gap-2 text-micro">
                <input
                  type="checkbox"
                  checked={updateProjectDefault}
                  onChange={(event) => setUpdateProjectDefault(event.target.checked)}
                />{" "}
                <span>
                  Use selected preset as the project default
                  <span className="block text-basic-muted">
                    Future chats inherit that saved preset, including its Advanced values. Existing
                    chats and children keep their settings.
                  </span>
                </span>
              </label>
            ) : null}
            <Separator />
            <button
              type="button"
              className="btn-ghost flex w-full items-center gap-1.5 rounded-[4px] p-2 text-btn-secondary"
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              <Icon iconName={IconName.Gear} size={20} />
              <span className="label-small flex-1 text-left">Advanced Configurations</span>
              <Icon iconName={advanced ? IconName.Down : IconName.Right} size={20} />
            </button>
            {advanced ? (
              <>
                {lightNeedsRepair && !policy.orchestrationEnabled ? (
                  <label className="text-micro">
                    <input
                      type="checkbox"
                      checked={clearMalformedLight}
                      onChange={(event) => setClearMalformedLight(event.target.checked)}
                    />{" "}
                    Clear malformed legacy light settings
                  </label>
                ) : null}
                <Separator />
                <ConfigRow
                  label="Reasoning Effort"
                  hint="Higher effort for deeper reasoning and lower effort for faster responses."
                  control={
                    <SmallSelect
                      items={reasoningItems}
                      value={reasoning}
                      onValueChange={setReasoning}
                    />
                  }
                />
                <Separator />
                <ConfigRow
                  label="Context Limit"
                  hint="Context size that triggers compaction. Defaults to 70% of the model's context length."
                  control={
                    <div className="flex items-center gap-2">
                      <Input
                        inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                        className={CONTROL_WIDTH}
                        inputClassName="md:text-right"
                        aria-label="Context limit"
                        placeholder={compactionPlaceholder}
                        inputMode="numeric"
                        value={compaction}
                        onChange={(event) => {
                          compactionPresetRef.current = false;
                          compactionAutoRef.current = false;
                          compactionRef.current = event.target.value;
                          setCompaction(event.target.value);
                        }}
                      />
                      <span className="shrink-0 text-micro text-basic-muted">tokens</span>
                    </div>
                  }
                />
                <Separator />
                <TextArea
                  label="Extra headers (JSON object)"
                  textAreaSize={isMobile ? TextAreaSize.Large : TextAreaSize.Medium}
                  hintText="Blank sends none; header values must be strings."
                  placeholder='{ "X-Title": "NAC" }'
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                  textAreaClassName="h-[160px] resize-none font-mono"
                />
              </>
            ) : null}
          </div>
        </ModelSetupSection>
      </div>
    </SettingsShell>
  );
}
