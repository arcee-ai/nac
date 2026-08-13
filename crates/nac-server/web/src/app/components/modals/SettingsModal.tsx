import { useCallback, useState } from "react";

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
import {
  ConfigurationsPanel,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { ConfigRow, CONTROL_WIDTH } from "@/app/components/modals/ConfigRow";
import { reasoningOptionsFor } from "@/app/components/modals/options";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useCompactionThreshold } from "@/app/hooks/useCompactionThreshold";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import {
  buildSettingsPatch,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";
import { displaySessionTitle } from "@/app/lib/format";
import { humanErrorText } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ApiError } from "@/app/services/api";
import {
  useCreateModelConfig,
  useModelCatalog,
  useSessionConfig,
  useSessionSnapshot,
  useSessionSummary,
  useUpdateConfig,
  useUpdatePresentation,
} from "@/app/services/queries";
import {
  sshTargetFromSummary,
  useSshConnectionStatus,
} from "@/app/store/sshConnectionStore";
import type {
  BackendKind,
  RawSessionConfig,
  SessionMetadata,
  SessionSummarySnapshot,
  SshTarget,
} from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

function headersToText(headers: Record<string, string>): string {
  return Object.keys(headers).length === 0
    ? ""
    : JSON.stringify(headers, null, 2);
}

/** The persisted column is a JSON string; unparsable content means "repair me". */
function parseHeadersJson(
  json: string | null | undefined,
): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function initialFromMetadata(meta: SessionMetadata): SettingsInitialValues {
  return {
    model: meta.model,
    backend: meta.backend,
    base_url: meta.base_url ?? "",
    reasoning_effort: meta.reasoning_effort || null,
    api_key_env: meta.api_key_env || null,
    extra_headers: meta.extra_headers ?? {},
    // SessionMetadata does not carry the compaction threshold; the config
    // row does, and is merged in by the caller when available.
    orchestrator_compaction_threshold: null,
  };
}

function initialFromConfig(config: RawSessionConfig): SettingsInitialValues {
  return {
    model: config.model,
    backend: config.backend ?? "",
    base_url: config.base_url,
    reasoning_effort: config.reasoning_effort || null,
    api_key_env: config.api_key_env || null,
    extra_headers: parseHeadersJson(config.extra_headers_json),
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
  const { data: snapshot } = useSessionSnapshot(mounted ? id : null);
  const { data: entry, isLoading: isSummaryLoading } = useSessionSummary(
    mounted ? id : null,
  );
  // Fetched for diagnostics ("repair required") and as a fallback source when
  // the live snapshot is unavailable.
  const { data: config, isLoading } = useSessionConfig(mounted ? id : null);

  if (!mounted || !id) return null;

  const meta = snapshot?.metadata;
  const initial = meta
    ? {
        ...initialFromMetadata(meta),
        // Metadata lacks the compaction threshold, but the config row (always
        // fetched) carries it, so the field shows the live value.
        orchestrator_compaction_threshold:
          config?.orchestrator_compaction_threshold ?? null,
      }
    : config
      ? initialFromConfig(config)
      : null;

  if (!initial || !entry) {
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
  summary,
  diagnostics,
  onClose,
}: {
  open: boolean;
  id: string;
  initial: SettingsInitialValues;
  /** Carries the presentation version the title save has to match. */
  summary: SessionSummarySnapshot;
  diagnostics: string[];
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const updateConfig = useUpdateConfig();
  const createModelConfig = useCreateModelConfig();
  const [openingSummary] = useState(summary);
  const updatePresentation = useUpdatePresentation();

  const initialTitle = openingSummary.title ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [model, setModel] = useState(initial.model);
  const [backend, setBackend] = useState(initial.backend);
  const [reasoning, setReasoning] = useState(initial.reasoning_effort ?? "");
  const [headers, setHeaders] = useState(headersToText(initial.extra_headers));
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<LaunchModelSelection | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const onConfigurationChange = useCallback(
    (next: LaunchModelSelection | null) => {
      setSelection(next);
      if (!next) return;
      const values = next.kind === "resolved" ? next : next.request;
      setBackend(values.backend);
      setModel(values.model);
      if (next.kind === "resolved") {
        setReasoning(next.reasoning_effort ?? "");
        setHeaders(headersToText(next.extra_headers ?? {}));
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

  const {
    value: compaction,
    placeholder: compactionPlaceholder,
    onChange: onCompactionChange,
  } = useCompactionThreshold({
    catalog: catalog.data,
    backend,
    model,
    initialValue: initial.orchestrator_compaction_threshold,
  });

  const blocked = !selection;
  const busy =
    updateConfig.isPending ||
    updatePresentation.isPending ||
    createModelConfig.isPending;

  const seedTarget = sshTargetFromSummary(openingSummary);
  const sshStatus = useSshConnectionStatus(seedTarget);
  // Null means "follow the shared store"; a concrete value is the user's last
  // Connect/Disconnect action in this dialog.
  const [sshConnection, setSshConnection] = useState<
    SshTarget | null | undefined
  >(undefined);
  const connectedTarget =
    sshConnection === undefined
      ? sshStatus === "connected"
        ? seedTarget
        : null
      : sshConnection;

  const onSshConnectionChange = (target: SshTarget | null) => {
    setSshConnection(target);
  };

  const saveTitle = async () => {
    if (title.trim() === initialTitle.trim()) return;
    try {
      await updatePresentation.mutateAsync({
        id,
        title: title.trim(),
        pinned: Boolean(openingSummary.pinned),
        expectedVersion: openingSummary.presentation_version ?? 0,
      });
    } catch (saveError) {
      const conflict =
        saveError instanceof ApiError && saveError.status === 409;
      toast.error(
        conflict
          ? "The title was not saved — the session changed in the meantime"
          : `The title was not saved: ${errorMessage(saveError)}`,
      );
    }
  };

  const submit = async () => {
    if (busy || !selection) return;

    let selected: {
      backend: BackendKind;
      model: string;
      base_url: string;
      api_key_env: string | null;
    };
    try {
      if (selection.kind === "save") {
        const record = await createModelConfig.mutateAsync(selection.request);
        selected = {
          backend: record.backend as BackendKind,
          model: record.model,
          base_url: record.base_url,
          api_key_env: record.api_key_env,
        };
      } else {
        selected = selection;
      }
    } catch (saveError) {
      setError(
        `The configuration could not be saved: ${humanErrorText(saveError)}`,
      );
      return;
    }

    let patch;
    try {
      patch = buildSettingsPatch(
        {
          model: selected.model,
          backend: selected.backend,
          base_url: selected.base_url,
          reasoning_effort: reasoning,
          credential_mode: selected.api_key_env ? "variable" : "none",
          api_key_env: selected.api_key_env ?? "",
          extra_headers: headers,
          orchestrator_compaction_threshold: compaction,
        },
        initial,
      );
    } catch (validationError) {
      setError(errorMessage(validationError));
      return;
    }

    setError("");
    // The title lives on a different endpoint, so it is saved either way — a
    // rename should not be lost because the configuration happened to be
    // untouched, nor the other way round.
    await saveTitle();

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    try {
      await updateConfig.mutateAsync({ id, patch });
      toast.success("Session settings saved");
      onClose();
    } catch (saveError) {
      const busyRun = saveError instanceof ApiError && saveError.status === 409;
      toast.error(
        busyRun
          ? "Session is busy — try again after the run finishes"
          : `Error: ${humanErrorText(saveError, backend)}`,
      );
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
          <SshBadge
            state={sshStatus === "connected" ? "connected" : "disconnected"}
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-6 [&>*]:shrink-0">
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
          inputSize={isMobile ? InputSize.Large : InputSize.Medium}
          placeholder={displaySessionTitle(openingSummary) || "Session name"}
          hintText="Leave empty to restore the automatic title (the last prompt)."
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <ConfigurationsPanel
          invalid={Boolean(error)}
          errorText={error || undefined}
          initial={{
            backend: initial.backend as BackendKind,
            model: initial.model,
            base_url: initial.base_url,
            api_key_env: initial.api_key_env,
            reasoning_effort: initial.reasoning_effort,
            extra_headers: initial.extra_headers,
          }}
          onChange={onConfigurationChange}
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn-ghost flex w-full items-center gap-1.5 rounded-[4px] p-2 text-btn-secondary"
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              <Icon iconName={IconName.Gear} size={20} />
              <span className="label-small flex-1 text-left">
                Advanced Configurations
              </span>
              <Icon
                iconName={advanced ? IconName.Down : IconName.Right}
                size={20}
              />
            </button>
            {advanced ? (
              <>
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
                    <Input
                      inputSize={
                        isMobile ? InputSize.Large : InputSize.Medium
                      }
                      className={CONTROL_WIDTH}
                      inputClassName="md:text-right"
                      placeholder={compactionPlaceholder}
                      inputMode="numeric"
                      value={compaction}
                      onChange={(event) =>
                        onCompactionChange(event.target.value)
                      }
                    />

                  }
                />
                <Separator />
                <TextArea
                  label="Extra headers (JSON object)"
                  textAreaSize={
                    isMobile ? TextAreaSize.Large : TextAreaSize.Medium
                  }
                  hintText="Blank sends none; header values must be strings."
                  placeholder='{ "X-Title": "NAC" }'
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                  textAreaClassName="h-[160px] resize-none font-mono"
                />
              </>
            ) : null}
          </div>
        </ConfigurationsPanel>

        {error ? (
          <p className="text-error-primary text-micro">{error}</p>
        ) : null}
      </div>
    </SettingsShell>
  );
}
