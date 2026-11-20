import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
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
import { type LaunchModelSelection } from "@/app/features/setup/modelSelection";
import { FormSection } from "@/app/components/modals/FormSection";
import { ConfigRow, CONTROL_WIDTH } from "@/app/components/modals/ConfigRow";
import { reasoningOptionsFor } from "@/app/components/modals/options";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { observeSettingsFieldVisibility } from "@/app/components/modals/settingsFieldVisibility";
import { matchesManagedModelPick } from "@/app/features/managed/model";
import { useManagedHostStatus } from "@/app/features/managed/queries";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { buildSettingsPatch, type SettingsInitialValues } from "@/app/lib/modelConfig";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { useToast } from "@/app/providers/ToastProvider";

import { ModelSetupSection } from "@/app/features/setup/ModelSetupSection";
import { sameModelSelection } from "@/app/features/setup/modelSelection";
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
  useModelCatalog,
  useSessionConfig,
  useSessionSummary,
  useUpdateConfig,
  useUpdatePresentation,
} from "@/app/services/queries";

import type {
  BackendKind,
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
    compaction_threshold: config.compaction_threshold,
    automatic_compaction: config.automatic_compaction ?? false,
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
  const isMobile = useIsMobile();

  // Reserve the phone footer's rendered height when its actions wrap.
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
      className="h-[700px] max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11 [&>.modal-footer-mobile]:relative [&>.modal-footer-mobile]:shrink-0 [&>.modal-footer-mobile]:flex-wrap"
      bodyClassName={isMobile && footer ? "pb-4" : undefined}
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

  if (!initial || !entry || isLoading) {
    return (
      <SettingsShell open={open} onClose={onClose}>
        <p className="p-6 text-small !leading-[22px] text-basic-secondary">
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
  initialVersion,
  summary,
  diagnostics,
  onClose,
}: {
  open: boolean;
  id: string;
  initial: SettingsInitialValues;
  initialVersion?: number;
  /** Carries the presentation version the title save has to match. */
  summary: SessionSummarySnapshot;
  diagnostics: string[];
  onClose: () => void;
}) {
  const { useSshConnectionStatus, sshTargetFromSummary } =
    useNativeRuntime().stores.sshConnectionStore;

  const { api } = useNativeRuntime();

  const isMobile = useIsMobile();
  const toast = useToast();
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = contentRef.current;
    const view = content?.ownerDocument.defaultView;
    // Flush desktop cards scroll the outer wrapper; phones scroll the inner body.
    const scope = isMobile ? content : content?.parentElement;
    if (view && scope instanceof view.HTMLDivElement) return observeSettingsFieldVisibility(scope);
  }, [isMobile]);
  const client = useQueryClient();
  const action = useSetupAction(open);
  const sessionTitle = useSessionTitle();
  const updateConfig = useUpdateConfig();
  const managedHostQuery = useManagedHostStatus();
  const managedHost = managedHostQuery.data ?? null;
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
    initial.compaction_threshold != null
      ? String(initial.compaction_threshold)
      : "",
  );
  // Track whether the compaction value was auto-suggested (vs. user-entered)
  // so model changes don't clobber a manual value. The ref mirrors the state
  // so the auto-suggest effect can read it without depending on the state.
  // A persisted null is disabled, not an invitation to change it on mount.
  const compactionAutoRef = useRef(initial.automatic_compaction ?? false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<LaunchModelSelection | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const projectedSelection = useRef<LaunchModelSelection | null>(null);
  const onConfigurationChange = useCallback((next: LaunchModelSelection | null) => {
    setSelection(next);
    if (!next || sameModelSelection(projectedSelection.current, next)) return;
    const previous = projectedSelection.current;
    projectedSelection.current = next;
    setBackend(next.backend);
    setModel(next.model);
    setBaseUrl(next.base_url);
    setReasoning(next.reasoning_effort ?? "");
    const sameProviderRoute =
      previous &&
      previous.backend === next.backend &&
      previous.base_url === next.base_url &&
      previous.api_key_env === next.api_key_env &&
      previous.allow_insecure_http === next.allow_insecure_http;
    if (!sameProviderRoute) setHeaders(headersToText(next.extra_headers ?? {}));
  }, []);

  // Only the levels this model actually accepts: the backend rejects the rest,
  // so offering them would only produce a save that fails.
  const catalog = useModelCatalog();
  const reasoningItems = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, backend, model).supportedEfforts,
    reasoning,
  );

  const compactionPlaceholder = useMemo(() => {
    const resolved = resolveCatalogModel(catalog.data, backend, model);
    const threshold = resolved.automaticThreshold;
    return threshold != null ? String(threshold) : "auto";
  }, [catalog.data, backend, model]);

  // Auto-suggest 70% of the selected model's effective input budget as the compaction
  // threshold. A manually entered value is preserved across model changes —
  // the suggestion only fills the field when it is empty or was itself last
  // auto-suggested.
  useEffect(() => {
    if (compactionPlaceholder !== "auto" && compactionAutoRef.current) {
      compactionAutoRef.current = true;
      setCompaction(compactionPlaceholder);
    }
  }, [compactionPlaceholder, selection]);

  const blocked = !selection || action.needsReview || action.busy;
  const busy =
    action.busy ||
    managedHostQuery.isPending ||
    updateConfig.isPending ||
    updatePresentation.isPending;

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
          compaction_threshold: compaction,
        },
        initial,
        allowsCredentiallessSelection,
      );
      if (initial.automatic_compaction && compactionAutoRef.current) {
        delete patch.compaction_threshold;
      } else if (initial.automatic_compaction) {
        // Editing an automatic value makes it intentional even when the
        // entered number happens to equal the current suggestion.
        patch.compaction_threshold = compaction.trim() ? Number(compaction) : null;
      }
    } catch (validationError) {
      throw new SetupValidation(
        validationError instanceof Error ? validationError.message : String(validationError),
      );
    }
    return patch;
  };

  const submit = async () => {
    if (busy || action.needsReview || !selection) return;

    let configurationChanged = false;
    try {
      const preview = patchFor(selection);
      configurationChanged = Object.keys(preview).length > 0;
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
          persistsModel: false,
          model: async () => selection,
          configurationSaved: configurationChanged,
          configuration: async (selected) => {
            const patch = patchFor(selected);

            if (Object.keys(patch).length > 0) await updateConfig.mutateAsync({ id, patch });
          },
          title: title.trim() !== initialTitle.trim() ? saveTitle : undefined,
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
          className="min-h-11"
          buttonClassName="min-h-11 min-w-11"
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
          className="min-h-11"
          buttonClassName="min-h-11 min-w-11"
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
      <div ref={contentRef} className="flex min-w-0 flex-col gap-8 [&>*]:shrink-0">
        <p className="text-small !leading-[22px] text-basic-secondary">
          Changes apply to this inactive primary chat. Existing children keep their settings.
        </p>
        {diagnostics.length > 0 ? (
          <div className="rounded-[4px] border border-error-muted bg-error-tertiary p-4 text-small !leading-[22px] text-error-primary">
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

        <FormSection title="Chat details" description="Name this chat so it is easy to find again.">
          <Input
            label="Session title"
            aria-label="Session title"
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            placeholder={sessionTitle(openingSummary) || "Session name"}
            hintText="Leave empty to restore the automatic title (the last prompt)."
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormSection>

        <ModelSetupSection
          existingSession
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
            compaction_threshold: initial.compaction_threshold,
          }}
          onChange={onConfigurationChange}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <Separator />
            <button
              type="button"
              className="btn-ghost flex min-h-11 w-full items-center gap-2 rounded-[4px] p-3 text-btn-secondary"
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              <Icon iconName={IconName.Gear} size={20} />
              <span className="label-small flex-1 text-left">Advanced Configurations</span>
              <Icon iconName={advanced ? IconName.Down : IconName.Right} size={20} />
            </button>
            {advanced ? (
              <FormSection
                title="Runtime preferences"
                description="Optional reasoning, context and request headers for this chat."
              >
                <Separator />
                <ConfigRow
                  presentation="form"
                  label="Reasoning Effort"
                  hint="Higher effort for deeper reasoning and lower effort for faster responses."
                  control={
                    <SmallSelect
                      presentation="form"
                      items={reasoningItems}
                      value={reasoning}
                      onValueChange={setReasoning}
                    />
                  }
                />
                <Separator />
                <ConfigRow
                  presentation="form"
                  label="Context Limit"
                  hint="Context size that triggers compaction. Defaults to 70% of the model's effective input budget, subject to provider limits."
                  control={
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                        className={CONTROL_WIDTH}
                        inputClassName="md:text-right"
                        aria-label="Context limit"
                        placeholder={compactionPlaceholder}
                        inputMode="numeric"
                        value={compaction}
                        onChange={(event) => {
                          compactionAutoRef.current = false;
                          setCompaction(event.target.value);
                        }}
                      />
                      <span className="shrink-0 text-micro text-basic-muted">tokens</span>
                    </div>
                  }
                />
                <Separator />
                <TextArea
                  label="Extra headers"
                  aria-label="Extra headers (JSON object)"
                  textAreaSize={isMobile ? TextAreaSize.Large : TextAreaSize.Medium}
                  hintText="Enter a JSON object with string values. Blank sends none."
                  placeholder='{ "X-Title": "NAC" }'
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                  textAreaClassName="h-[160px] resize-none font-mono"
                />
              </FormSection>
            ) : null}
          </div>
        </ModelSetupSection>
      </div>
    </SettingsShell>
  );
}
