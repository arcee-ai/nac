import { useState } from "react";

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
import { KeyStatus } from "@/app/components/modals/KeyStatus";
import {
  MixedModelsSection,
  type MixedSelection,
} from "@/app/components/modals/MixedModelsSection";
import {
  BACKEND_OPTIONS,
  reasoningOptionsFor,
} from "@/app/components/modals/options";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { useDeviceLogin } from "@/app/hooks/useDeviceLogin";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useManagedSignIn } from "@/app/hooks/useManagedSignIn";
import {
  isGeneratedCredentialName,
  KEY_DEBOUNCE_MS,
  MASKED_KEY,
  modelItems,
  type Validation,
} from "@/app/lib/apiKey";
import {
  inheritPrimaryCredential,
  buildSettingsPatch,
  managedLaunchBaseUrl,
  sameMixedModels,
  type CredentialMode,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";
import { displaySessionTitle } from "@/app/lib/format";
import { providerUsesApiKey } from "@/app/lib/providers";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ApiError } from "@/app/services/api";
import {
  useManagedLogout,
  useManagedProviderModels,
  useModelCatalog,
  useProviderModels,
  useSessionConfig,
  useSessionSnapshot,
  useSessionSummary,
  useStoreGeneratedCredential,
  useStoredKeyProviderModels,
  useUpdateConfig,
  useUpdatePresentation,
} from "@/app/services/queries";
import {
  sshTargetFromSummary,
  useSshConnectionStatus,
} from "@/app/store/sshConnectionStore";
import type {
  BackendKind,
  MixedModels,
  RawSessionConfig,
  SessionMetadata,
  SessionSummarySnapshot,
  SshTarget,
} from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

/** Stands in for the name a key gets while the form is only being checked. */
const PENDING_KEY_NAME = "NAC_CONFIG_pending";

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
    ? initialFromMetadata(meta)
    : config
      ? initialFromConfig(config)
      : null;

  // The form seeds its mixed-mode state from `config` once at mount, so it
  // must not mount before /config settles — a mixed config arriving later
  // would leave the form on Single and a save would clear mixed mode.
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
      open={open}
      id={id}
      initial={initial}
      initialMixed={config?.mixed_models ?? null}
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
  initialMixed,
  summary,
  diagnostics,
  onClose,
}: {
  open: boolean;
  id: string;
  initial: SettingsInitialValues;
  /** The mixed tiers the session currently runs with, if any. */
  initialMixed: MixedModels | null;
  /** Carries the presentation version the title save has to match. */
  summary: SessionSummarySnapshot;
  diagnostics: string[];
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const updateConfig = useUpdateConfig();
  const [openingSummary] = useState(summary);
  const updatePresentation = useUpdatePresentation();
  const storeKey = useStoreGeneratedCredential();

  const initialTitle = openingSummary.title ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [model, setModel] = useState(initial.model);
  const [backend, setBackend] = useState(initial.backend);
  const [reasoning, setReasoning] = useState(initial.reasoning_effort ?? "");
  const [baseUrl, setBaseUrl] = useState(initial.base_url);
  const [headers, setHeaders] = useState(headersToText(initial.extra_headers));
  // Null while the session keeps the key it already has. A string is a
  // replacement being typed, and an empty one means the key was taken away.
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [mixed, setMixed] = useState<MixedSelection>({
    mode: initialMixed ? "mixed" : "single",
    mixed: initialMixed,
  });
  const [error, setError] = useState("");

  // A malformed stored mixed config loads as null with only a diagnostic; the
  // server then refuses patches that omit mixed_models, so saving must always
  // send an explicit repair or clear.
  const mixedNeedsRepair = diagnostics.some((diagnostic) =>
    diagnostic.startsWith("malformed stored mixed models"),
  );

  const kind = backend as BackendKind;
  const managedUrl = managedLaunchBaseUrl(backend);
  const locked = Boolean(managedUrl);
  const displayBaseUrl = managedUrl ?? baseUrl;
  const usesKey = providerUsesApiKey(kind);
  // A session with nothing on file has nothing to show either, so the row opens
  // ready for a key rather than displaying a stand-in for one that is not there.
  const editingKey = keyDraft !== null || !initial.api_key_env;
  const draftKey = (keyDraft ?? "").trim();
  const storedKeyEnv = editingKey ? "" : (initial.api_key_env ?? "");

  // A pasted key is checked against the provider, and one already on file is
  // checked by name — either way by listing the models it reaches, so the same
  // answer says whether the credential works and what the session may run.
  const debouncedKey = useDebouncedValue(draftKey, KEY_DEBOUNCE_MS);
  const debouncedBaseUrl = useDebouncedValue(baseUrl.trim(), KEY_DEBOUNCE_MS);
  const draftQuery = useProviderModels(
    kind,
    debouncedKey,
    debouncedBaseUrl || null,
    usesKey && editingKey,
  );
  const storedQuery = useStoredKeyProviderModels(
    kind,
    storedKeyEnv,
    debouncedBaseUrl || null,
    usesKey && !editingKey,
  );
  const keyQuery = editingKey ? draftQuery : storedQuery;
  const validation: Validation = !usesKey
    ? { status: "idle" }
    : keyQuery.isFetching
      ? { status: "validating" }
      : keyQuery.isError
        ? { status: "error", message: errorMessage(keyQuery.error) }
        : keyQuery.data
          ? {
              status: "ready",
              models: keyQuery.data.models,
              baseUrl: keyQuery.data.base_url,
            }
          : { status: "idle" };

  // Only the levels this model actually accepts: the backend rejects the rest,
  // so offering them would only produce a save that fails.
  const catalog = useModelCatalog();
  const reasoningItems = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, backend, model).supportedEfforts,
    reasoning,
  );

  const { provider, signedIn } = useManagedSignIn(kind);
  const loginQuery = useManagedProviderModels(
    kind,
    Boolean(provider) && signedIn,
  );
  const models =
    (usesKey
      ? validation.status === "ready"
        ? validation.models
        : []
      : loginQuery.data?.models) ?? [];

  // The provider decides the mode: a managed backend authenticates from its
  // stored login, and everywhere else a named key is the only other source.
  const credentialMode: CredentialMode = usesKey ? "variable" : "none";
  // What blocks a save is a credential known to be unusable, not one that has
  // merely not been checked: an unreachable provider should never stand between
  // the user and renaming their session.
  const missingKey = usesKey && editingKey && draftKey.length === 0;
  const blocked =
    missingKey ||
    validation.status === "error" ||
    Boolean(provider && !signedIn);
  const busy =
    updateConfig.isPending ||
    updatePresentation.isPending ||
    storeKey.isPending;

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
    if (busy || blocked) return;

    const valuesWith = (apiKeyEnv: string) => ({
      model,
      backend,
      base_url: baseUrl,
      reasoning_effort: reasoning,
      credential_mode: credentialMode,
      api_key_env: apiKeyEnv,
      extra_headers: headers,
    });

    // Nothing is filed away until the rest of the form is known to be good, so
    // a rejected header map cannot leave an orphaned key behind. The stand-in
    // only stands where the generated name will, and never reaches the server.
    try {
      buildSettingsPatch(
        valuesWith(draftKey ? PENDING_KEY_NAME : storedKeyEnv),
        initial,
      );
    } catch (validationError) {
      setError(errorMessage(validationError));
      return;
    }

    let apiKeyEnv = storedKeyEnv;
    if (usesKey && draftKey) {
      try {
        apiKeyEnv = (await storeKey.mutateAsync(draftKey)).name;
      } catch (storeError) {
        setError(`The key was not stored: ${errorMessage(storeError)}`);
        return;
      }
    }

    let patch;
    try {
      patch = buildSettingsPatch(valuesWith(apiKeyEnv), initial);
    } catch (validationError) {
      setError(errorMessage(validationError));
      return;
    }

    if (mixed.mode === "mixed") {
      if (!mixed.mixed) {
        setError("Complete the easy, medium and hard tiers before saving.");
        return;
      }
      const finalMixed = inheritPrimaryCredential(
        mixed.mixed,
        kind,
        apiKeyEnv || null,
        initial.api_key_env,
      );
      if (mixedNeedsRepair || !sameMixedModels(finalMixed, initialMixed)) {
        patch.mixed_models = finalMixed;
      }
    } else if (initialMixed || mixedNeedsRepair) {
      patch.mixed_models = null;
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
      const message = errorMessage(saveError);
      toast.error(
        /HTTP 409/.test(message)
          ? "Session is busy — try again after the run finishes"
          : `Error: ${message}`,
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

        <Separator />

        <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-4">
          <InputWrapper label="Provider">
            <Select
              items={BACKEND_OPTIONS}
              value={backend}
              onValueChange={setBackend}
              className="w-full"
              triggerClassName="w-full"
              panelClassName="max-h-64 overflow-auto"
              size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            />
          </InputWrapper>
          <Input
            label="Base URL"
            inputSize={isMobile ? InputSize.Large : InputSize.Medium}
            value={displayBaseUrl}
            isDisabled={locked}
            hintText={locked ? "Managed by the selected provider." : undefined}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>

        {usesKey ? (
          <ApiKeyField
            editing={editingKey}
            draft={keyDraft ?? ""}
            stored={initial.api_key_env ?? ""}
            validation={validation}
            onDraft={setKeyDraft}
            onClear={() => setKeyDraft("")}
            onRestore={() => setKeyDraft(null)}
          />
        ) : (
          <AuthenticationField backend={kind} />
        )}

        {/* Touch-sized controls need the whole width, so the pair stacks until
            the dialog has a desktop column to split. */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-4">
          <ModelField
            value={model}
            models={modelItems(models)}
            available={!blocked}
            onChange={setModel}
          />
          <InputWrapper label="Reasoning effort">
            <Select
              items={reasoningItems}
              value={reasoning}
              onValueChange={setReasoning}
              className="w-full"
              triggerClassName="w-full"
              panelClassName="max-h-64 overflow-auto"
              size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            />
          </InputWrapper>
        </div>

        <Separator />

        <MixedModelsSection initial={initialMixed} onChange={setMixed} />

        <Separator />

        <TextArea
          label="Extra headers (JSON object)"
          textAreaSize={isMobile ? TextAreaSize.Large : TextAreaSize.Medium}
          hintText="Blank sends none; header values must be strings."
          placeholder='{ "X-Title": "nac" }'
          value={headers}
          onChange={(event) => setHeaders(event.target.value)}
          textAreaClassName="h-[160px] resize-none font-mono"
        />

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
    ? "Paste the provider key. nac keeps it and hands the session a selector, never the secret."
    : isGeneratedCredentialName(stored)
      ? "Kept by nac for this session. Replacing it files a new key and leaves the old one where it is."
      : `Read from ${stored}: the environment variable, or a key of that name kept by nac.`;

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
 * rather than editing anything the session owns.
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
            <span>Login again</span>
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
            <span className="label-small text-success-primary">Logged in</span>
          </div>
        )}
        <Button
          variant={ButtonVariant.Ghost}
          size={buttonSize}
          content={ButtonContent.Text}
          loading={logout.isPending}
          onClick={() => void logout.mutateAsync(provider).catch(() => {})}
        >
          Logout
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
        <span>Login</span>
        <Icon iconName={IconName.External} />
      </Button>
    );

  return (
    <InputWrapper
      label="Authentication"
      validation={failed || expired}
      validationText={
        failed ? state.message : expired ? errorMessage(reach.error) : undefined
      }
      hintText={
        signedIn
          ? "Signed in through the browser; every session on this provider shares the login."
          : "This provider signs in through the browser, and the session cannot run until it has."
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
