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
  InputWrapper,
  Loader,
  LoaderSize,
  Modal,
  ModalSize,
  Select,
  type SelectItem,
  Separator,
  StickyButton,
  TextArea,
  TextAreaSize,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { SshBadge } from "@/app/components/SshBadge";
import {
  ConfigurationsPanel,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { ConfigRow, CONTROL_WIDTH } from "@/app/components/modals/ConfigRow";
import { KeyStatus } from "@/app/components/modals/KeyStatus";
import { reasoningOptionsFor } from "@/app/components/modals/options";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useCompactionThreshold } from "@/app/hooks/useCompactionThreshold";
import { useDeviceLogin } from "@/app/hooks/useDeviceLogin";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useManagedSignIn } from "@/app/hooks/useManagedSignIn";
import {
  isGeneratedCredentialName,
  MASKED_KEY,
  type Validation,
} from "@/app/lib/apiKey";
import {
  buildSettingsPatch,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";
import { displaySessionTitle } from "@/app/lib/format";
import { managedAuthLabel } from "@/app/lib/providers";
import { humanErrorText } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ApiError } from "@/app/services/api";
import {
  useManagedLogout,
  useManagedProviderModels,
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

/**
 * The key a key-authenticated session runs on. A stored key never comes back
 * from the server, so it can only be replaced, not read: the row shows a
 * stand-in until the user starts typing a new one, and reports how the key
 * checked out through the glyph in the leading slot.
 */
function ApiKeyField({
  editing,
  draft,
  stored,
  validation,
  onDraft,
  onClear,
  onRestore,
}: {
  editing: boolean;
  draft: string;
  /** The selector the session currently authenticates through, if any. */
  stored: string;
  validation: Validation;
  onDraft: (value: string) => void;
  /**
   * Empties the field. Replacing a key and removing one arrive at the same
   * place — a key that cannot be read back can only be overwritten — so the two
   * buttons differ in what they say rather than in what they leave behind.
   */
  onClear: () => void;
  onRestore: () => void;
}) {
  const isMobile = useIsMobile();
  const invalid = validation.status === "error";
  const hint = editing
    ? "Paste the provider key. NAC keeps it and hands the session a selector, never the secret."
    : isGeneratedCredentialName(stored)
      ? "Kept by NAC for this session. Replacing it files a new key and leaves the old one where it is."
      : `Read from ${stored}: the environment variable, or a key of that name kept by NAC.`;

  return (
    <InputWrapper
      label="API key"
      required
      validation={invalid}
      validationText={invalid ? validation.message : undefined}
      hintText={hint}
    >
      <div className="flex items-center gap-2">
        <Input
          className="flex-1 min-w-0"
          inputSize={isMobile ? InputSize.Large : InputSize.Medium}
          type="password"
          autoComplete="off"
          placeholder="Paste the provider key"
          value={editing ? draft : MASKED_KEY}
          readOnly={!editing}
          validation={invalid}
          leadingSlot={<KeyStatus status={validation.status} />}
          onChange={(event) => onDraft(event.target.value)}
        />
        <Tooltip
          title={editing ? "Keep the current key" : "Replace the key"}
          position={TooltipPosition.TopCenter}
        >
          <Button
            variant={ButtonVariant.Secondary}
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            content={ButtonContent.Icon}
            aria-label={editing ? "Keep the current key" : "Replace the key"}
            disabled={editing && !stored}
            onClick={editing ? onRestore : onClear}
          >
            <Icon iconName={editing ? IconName.Close : IconName.Edit} />
          </Button>
        </Tooltip>
        <Tooltip
          title="Remove the key from this session"
          position={TooltipPosition.TopCenter}
        >
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            content={ButtonContent.Icon}
            aria-label="Remove the key from this session"
            disabled={editing && !draft}
            onClick={onClear}
          >
            <Icon iconName={IconName.Trash} />
          </Button>
        </Tooltip>
      </div>
    </InputWrapper>
  );
}

/**
 * What a managed provider shows in place of a key: the credential is a browser
 * login shared by every session on that provider, so this row signs in and out
 * rather than editing anything the session owns. It is named after the account
 * being signed into rather than after authentication in the abstract, so the
 * button never leaves the destination to guesswork.
 */
function AuthenticationField({ backend }: { backend: BackendKind }) {
  const isMobile = useIsMobile();
  const buttonSize = isMobile ? ButtonSize.Large : ButtonSize.Medium;
  const { provider, signedIn } = useManagedSignIn(backend);
  const { state, start, cancel } = useDeviceLogin();
  const logout = useManagedLogout();
  // A credential on file is not the same as a working one, so the row leans on
  // the request that actually spends it rather than on the file being there.
  const reach = useManagedProviderModels(
    backend,
    Boolean(provider) && signedIn,
  );

  if (!provider) return null;

  const label = managedAuthLabel(provider);
  const failed = state.status === "failed";
  const expired = signedIn && reach.isError;
  const control =
    state.status === "waiting" ? (
      <div className="flex items-center gap-2">
        <Loader size={LoaderSize.Micro} />
        {state.prompt.user_code ? (
          <>
            <span className="text-micro text-basic-muted">Code</span>
            <span className="label-small text-basic-primary tabular-nums">
              {state.prompt.user_code}
            </span>
          </>
        ) : (
          <span className="text-micro text-basic-muted">
            Waiting for the browser
          </span>
        )}
        <Button
          variant={ButtonVariant.Ghost}
          size={buttonSize}
          content={ButtonContent.Text}
          onClick={() => void cancel()}
        >
          Cancel
        </Button>
      </div>
    ) : signedIn ? (
      <div className="flex items-center gap-2">
        {expired ? (
          <Button
            variant={ButtonVariant.Primary}
            size={buttonSize}
            content={ButtonContent.IconRight}
            loading={state.status === "starting"}
            onClick={() => void start(provider)}
          >
            <span>Sign in again</span>
            <Icon iconName={IconName.External} />
          </Button>
        ) : (
          <div
            // Height rather than padding, so the chip lines up with whichever
            // size the buttons beside it take.
            className={`flex items-center gap-1.5 rounded-[4px] bg-success-secondary pl-2 pr-4 ${isMobile ? "h-12" : "py-2"}`}
          >
            <Icon
              iconName={IconName.CheckCircle}
              className="text-success-primary"
            />
            <span className="label-small text-success-primary">Success</span>
          </div>
        )}
        <Button
          variant={ButtonVariant.Ghost}
          size={buttonSize}
          content={ButtonContent.Text}
          loading={logout.isPending}
          onClick={() => void logout.mutateAsync(provider).catch(() => {})}
        >
          Sign out
        </Button>
      </div>
    ) : (
      <Button
        variant={ButtonVariant.Primary}
        size={buttonSize}
        content={ButtonContent.IconRight}
        loading={state.status === "starting"}
        onClick={() => void start(provider)}
      >
        <span>Sign in with {label}</span>
        <Icon iconName={IconName.External} />
      </Button>
    );

  return (
    <InputWrapper
      label={`${label} sign-in`}
      validation={failed || expired}
      validationText={
        failed || expired
          ? humanErrorText(failed ? state.message : reach.error, backend)
          : undefined
      }
      hintText={
        signedIn
          ? `This provider authenticates with ${label} in your browser; the login is shared by every session on it.`
          : `This provider authenticates with ${label} in your browser instead of with an API key. The session cannot run until you sign in.`
      }
    >
      <div className="flex items-center">{control}</div>
    </InputWrapper>
  );
}

/**
 * The model the session runs. A provider that answers with a model index picks
 * from that list; a hand-written gateway that has none is typed in, and a
 * credential that is not working yet has nothing to offer either way.
 */
function ModelField({
  value,
  models,
  available,
  onChange,
}: {
  value: string;
  models: SelectItem[];
  /** Whether the credential is in a state that can reach a model at all. */
  available: boolean;
  onChange: (model: string) => void;
}) {
  const isMobile = useIsMobile();
  if (models.length === 0 && available) {
    return (
      <Input
        label="Model"
        inputSize={isMobile ? InputSize.Large : InputSize.Medium}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  // A model configured earlier may no longer be listed — a renamed or retired
  // one still has to show as what the session runs today.
  const items = models.some((item) => item.id === value)
    ? models
    : value
      ? [...models, { id: value, label: value }]
      : models;

  return (
    <InputWrapper label="Model">
      <Select
        items={items}
        value={value}
        onValueChange={onChange}
        disabled={!available}
        placeholder="–"
        className="w-full"
        triggerClassName="w-full"
        panelClassName="max-h-64 overflow-auto"
        size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
      />
    </InputWrapper>
  );
}

// Kept temporarily as implementation references while the shared configuration
// panel owns the active settings UI.
void ApiKeyField;
void AuthenticationField;
void ModelField;
