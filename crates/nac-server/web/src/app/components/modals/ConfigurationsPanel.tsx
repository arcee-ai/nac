import { useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  InputTrailing,
  type SelectItem,
  Separator,
} from "@/app/atoms";
import { AuthenticationRow } from "@/app/components/modals/AuthenticationRow";
import {
  CatalogModelPicker,
  type CatalogPick,
} from "@/app/components/modals/CatalogModelPicker";
import { ConfigRow, CONTROL_WIDTH } from "@/app/components/modals/ConfigRow";
import { KeyStatus } from "@/app/components/modals/KeyStatus";
import { PROTOCOL_ITEMS } from "@/app/components/modals/options";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { ResolvedRows } from "@/app/components/modals/ResolvedRows";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { type Source, SourceMenu } from "@/app/components/modals/SourceMenu";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useManagedSignIn } from "@/app/hooks/useManagedSignIn";
import { KEY_DEBOUNCE_MS, modelItems, type Validation } from "@/app/lib/apiKey";
import { cn } from "@/app/lib/cn";
import {
  PROVIDER_KINDS,
  providerLabel,
  providerUsesApiKey,
} from "@/app/lib/providers";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useDeleteModelConfig,
  useManagedProviderModels,
  useModelCatalog,
  useModelConfigs,
  useProviderModels,
  useResolvedModelConfig,
} from "@/app/services/queries";
import type {
  BackendKind,
  CreateModelConfigurationRequest,
} from "@/app/types/api";

/** What the panel hands the launch form once a provider setup is complete. */
export type LaunchModelSelection =
  | { kind: "save"; request: CreateModelConfigurationRequest }
  | {
      kind: "resolved";
      backend: BackendKind;
      model: string;
      base_url: string;
      api_key_env: string | null;
      reasoning_effort: string | null;
      extra_headers: Record<string, string> | null;
    };

/** A base URL the user writes by hand, for a gateway nac has no defaults for. */
const CUSTOM = "custom";
type ProviderChoice = BackendKind | typeof CUSTOM;

const PROVIDER_ITEMS: SelectItem[] = [
  ...PROVIDER_KINDS.map((kind) => ({ id: kind, label: providerLabel(kind) })),
  { id: CUSTOM, label: "Custom" },
];

const PATH_DEBOUNCE_MS = 400;

/**
 * Picks the provider setup a new session launches with: a model chosen out of
 * the catalog, a fresh setup, one saved earlier, or one read out of a
 * `config.toml`.
 *
 * A key is checked by listing the models it can reach, which is also where the
 * default model choices come from — the same request answers both questions.
 * Keys are handed to the server only to be validated, and are persisted solely
 * as part of saving a named configuration. Browsing the catalog asks for
 * nothing: it is local data, and a provider the server already authenticates as
 * launches straight from it.
 */
export function ConfigurationsPanel({
  invalid,
  errorText,
  onChange,
  children,
}: {
  /** The launch attempt failed on something the box owns. */
  invalid: boolean;
  errorText?: string;
  onChange: (selection: LaunchModelSelection | null) => void;
  /** Advanced section, which the design nests at the bottom of the box. */
  children?: React.ReactNode;
}) {
  const toast = useToast();
  const { data: saved } = useModelConfigs();
  const catalog = useModelCatalog();
  const deleteConfig = useDeleteModelConfig();
  const configurations = useMemo(() => saved?.configurations ?? [], [saved]);

  // Null until the user picks a source themselves, so the default below can
  // still settle once the list arrives.
  const [picked, setPicked] = useState<Source | null>(null);
  const [catalogPick, setCatalogPick] = useState<CatalogPick | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("openai-responses");
  const [protocol, setProtocol] = useState<BackendKind>("openai-responses");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [filePath, setFilePath] = useState("");
  const [picking, setPicking] = useState(false);
  // Layered over a resolved configuration; null follows what was saved.
  const [backendOverride, setBackendOverride] = useState<BackendKind | null>(
    null,
  );
  const [baseUrlOverride, setBaseUrlOverride] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  // Launching usually means reusing the setup from last time, so the newest
  // saved configuration opens selected. With nothing saved yet the catalog is
  // the only source that asks for nothing up front, so it opens instead.
  const latestSaved = configurations.at(-1);
  const source: Source =
    picked ??
    (latestSaved
      ? { kind: "saved", configId: latestSaved.config_id }
      : { kind: "catalog" });

  // A catalog entry names its own provider; everywhere else the dropdown does.
  const backend: BackendKind =
    source.kind === "catalog" && catalogPick
      ? catalogPick.backend
      : provider === CUSTOM
        ? protocol
        : provider;
  const needsKey = providerUsesApiKey(backend);
  // A hand-written gateway may not implement a model index, so its model and
  // URL are typed in rather than discovered.
  const discovers = provider !== CUSTOM && needsKey;

  const autoName = useMemo(() => {
    const base =
      source.kind === "catalog"
        ? (catalogPick?.backend ?? "catalog")
        : provider === CUSTOM
          ? "custom"
          : provider;
    const taken = new Set(configurations.map((entry) => entry.name));
    for (let index = 1; ; index += 1) {
      const candidate = `${base}-config-${index}`;
      if (!taken.has(candidate)) return candidate;
    }
  }, [source.kind, catalogPick, provider, configurations]);
  const name = nameDraft ?? autoName;

  const debouncedKey = useDebouncedValue(apiKey.trim(), KEY_DEBOUNCE_MS);
  const debouncedPath = useDebouncedValue(filePath.trim(), PATH_DEBOUNCE_MS);

  const configId = source.kind === "saved" ? source.configId : null;
  const configFile = source.kind === "file" ? debouncedPath : "";
  const isMobile = useIsMobile();
  const { signedIn } = useManagedSignIn(backend);

  const catalogProvider =
    catalog.data?.providers.find((entry) => entry.id === backend) ?? null;
  /**
   * Whether the server can already authenticate as the picked provider. A
   * managed one answers from the live sign-in rather than the catalog snapshot,
   * which still reads `no_credential` for the seconds after a login lands.
   */
  const catalogCredential = needsKey
    ? catalogProvider?.auth_status === "ready"
    : signedIn;
  // Only an API-key provider can be fixed from here; a managed one needs its
  // browser login, which the Authentication row owns.
  const catalogNeedsKey =
    source.kind === "catalog" &&
    Boolean(catalogPick) &&
    needsKey &&
    !catalogCredential;

  const validates = (source.kind === "new" && discovers) || catalogNeedsKey;
  const keyQuery = useProviderModels(backend, debouncedKey, null, validates);
  // A login reaches a model index the same way a key does; it just cannot be
  // read before the sign-in exists.
  const loginQuery = useManagedProviderModels(
    backend,
    source.kind === "new" && provider !== CUSTOM && !needsKey && signedIn,
  );
  const configQuery = useResolvedModelConfig(configId, configFile);

  const validation: Validation = !(validates && debouncedKey)
    ? { status: "idle" }
    : keyQuery.isFetching
      ? { status: "validating" }
      : keyQuery.error
        ? { status: "error", message: errorMessage(keyQuery.error) }
        : keyQuery.data
          ? {
              status: "ready",
              models: keyQuery.data.models,
              baseUrl: keyQuery.data.base_url,
            }
          : { status: "validating" };

  const keyValidated = validation.status === "ready";
  const validatedBaseUrl = keyQuery.data?.base_url ?? "";

  const resolvedTarget = Boolean(configId ?? configFile);
  const resolving = resolvedTarget && configQuery.isFetching;
  const resolved =
    resolvedTarget && !configQuery.error ? (configQuery.data ?? null) : null;
  const resolveError =
    resolvedTarget && configQuery.error ? errorMessage(configQuery.error) : "";

  // A saved setup is a starting point rather than a lock: these follow what the
  // server resolved until the user changes them for the session being created.
  const savedBackend = backendOverride ?? resolved?.backend ?? null;
  const savedBaseUrl = baseUrlOverride ?? resolved?.base_url ?? "";

  // Derived rather than stored, so a stale pick never survives a source change.
  const models =
    source.kind === "new"
      ? ((needsKey ? keyQuery.data?.models : loginQuery.data?.models) ?? [])
      : (resolved?.models ?? []);
  const configuredModel = source.kind === "new" ? "" : (resolved?.model ?? "");
  const chosenModel = models.some((model) => model.id === defaultModel)
    ? defaultModel
    : models.some((model) => model.id === configuredModel)
      ? configuredModel
      : (models[0]?.id ?? modelOverride ?? configuredModel);

  /** Passing null hands the choice back to the default above. */
  const switchSource = (next: Source | null) => {
    setPicked(next);
    setApiKey("");
    setDefaultModel("");
    setBackendOverride(null);
    setBaseUrlOverride(null);
    setModelOverride(null);
    if (next?.kind !== "file") setFilePath("");
    if (next?.kind !== "catalog") setCatalogPick(null);
    if (next?.kind !== "new" && next?.kind !== "catalog") setNameDraft(null);
  };

  const savedRecord = configId
    ? (configurations.find((entry) => entry.config_id === configId) ?? null)
    : null;

  const selection = useMemo<LaunchModelSelection | null>(() => {
    if (source.kind === "catalog") {
      if (!catalogPick || !catalogPick.baseUrl) return null;
      if (catalogCredential) {
        // The credential is already on the server, so nothing is saved and
        // `api_key_env` stays unset for session resolution to fill in with the
        // same variable the catalog checked.
        return {
          kind: "resolved",
          backend: catalogPick.backend,
          model: catalogPick.model,
          base_url: catalogPick.baseUrl,
          api_key_env: null,
          reasoning_effort: null,
          extra_headers: null,
        };
      }
      // A managed provider is waiting on its login, which nothing here can
      // stand in for.
      if (!needsKey) return null;
      const trimmedName = name.trim();
      if (!trimmedName || !keyValidated) return null;
      return {
        kind: "save",
        request: {
          name: trimmedName,
          backend: catalogPick.backend,
          model: catalogPick.model,
          base_url: validatedBaseUrl || catalogPick.baseUrl,
          api_key: apiKey.trim(),
        },
      };
    }

    if (source.kind === "new") {
      const trimmedName = name.trim();
      if (!trimmedName) return null;
      const key = apiKey.trim();
      if (needsKey && !key) return null;

      if (provider === CUSTOM) {
        const url = baseUrlDraft.trim();
        const model = modelDraft.trim();
        if (!url || !model) return null;
        return {
          kind: "save",
          request: {
            name: trimmedName,
            backend,
            model,
            base_url: url,
            api_key: needsKey ? key : null,
          },
        };
      }
      if (!needsKey) {
        // The login is the credential, so there is nothing worth saving until
        // it exists — and the model list only loads once it does.
        if (!signedIn || !chosenModel) return null;
        return {
          kind: "save",
          request: { name: trimmedName, backend, model: chosenModel },
        };
      }
      if (!keyValidated || !chosenModel || !validatedBaseUrl) return null;
      return {
        kind: "save",
        request: {
          name: trimmedName,
          backend,
          model: chosenModel,
          base_url: validatedBaseUrl,
          api_key: key,
        },
      };
    }

    if (!resolved || !savedBackend) return null;
    const model = chosenModel || resolved.model || "";
    const url = savedBaseUrl.trim();
    if (!model || !url) return null;
    return {
      kind: "resolved",
      backend: savedBackend,
      model,
      base_url: url,
      api_key_env: resolved.api_key_env,
      reasoning_effort: resolved.reasoning_effort,
      extra_headers: savedRecord?.extra_headers ?? null,
    };
  }, [
    source.kind,
    catalogPick,
    catalogCredential,
    name,
    apiKey,
    needsKey,
    provider,
    backend,
    baseUrlDraft,
    modelDraft,
    signedIn,
    keyValidated,
    validatedBaseUrl,
    chosenModel,
    resolved,
    savedBackend,
    savedBaseUrl,
    savedRecord,
  ]);

  useEffect(() => {
    onChange(selection);
  }, [selection, onChange]);

  const onDelete = async (id: string, label: string) => {
    try {
      await deleteConfig.mutateAsync(id);
      // Fall back to the default rather than to "Create New", so removing one
      // of several setups lands on the next most recent.
      if (configId === id) switchSource(null);
      toast.success(`Configuration ${label} removed`);
    } catch (error) {
      toast.error(`Failed to remove the configuration: ${errorMessage(error)}`);
    }
  };

  /**
   * Whether the credential this setup rests on is settled. What follows it —
   * which model, and the advanced knobs — cannot be answered before then, so
   * the rows stay out of the way rather than sitting there unanswerable.
   *
   * A hand-written setup has no credential to settle: its URL and model are the
   * fields being filled in, so having them is the equivalent milestone.
   */
  const credentialReady =
    source.kind === "catalog"
      ? Boolean(catalogPick) && (catalogCredential || keyValidated)
      : source.kind === "new"
        ? provider === CUSTOM
          ? Boolean(baseUrlDraft.trim() && modelDraft.trim())
          : needsKey
            ? keyValidated
            : signedIn
        : Boolean(resolved);

  const keyInvalid = validation.status === "error";
  // A login that cannot read the model index leaves the same empty list as a
  // provider with nothing to offer, so saying which one it is has to be explicit.
  const modelListError = loginQuery.isError
    ? errorMessage(loginQuery.error)
    : (resolved?.models_error ?? "");
  const boxInvalid =
    invalid || keyInvalid || Boolean(resolveError) || Boolean(modelListError);
  // Authentication already shows the failure (and Login again) for a managed
  // provider whose model index refused; keep the footer for resolve / key / API
  // key listing errors that have no other home.
  const authOwnsError =
    loginQuery.isError ||
    Boolean(
      resolved &&
      !providerUsesApiKey(resolved.backend) &&
      resolved.models_error,
    );
  const message =
    errorText ??
    (keyInvalid
      ? validation.message
      : resolveError || (authOwnsError ? "" : modelListError));
  // Resolve failures are always worth asking again. A saved setup whose model
  // index failed is too — unless Authentication already offers Login again.
  const retry = resolveError
    ? configQuery.refetch
    : resolved?.models_error && providerUsesApiKey(resolved.backend)
      ? configQuery.refetch
      : null;

  const sourceLabel =
    source.kind === "catalog"
      ? "Browse Models"
      : source.kind === "new"
        ? "Create New"
        : source.kind === "file"
          ? "From a .toml file"
          : (savedRecord?.name ?? "Configuration");

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex flex-col rounded-[8px] bg-elevation-level-2 border border-muted overflow-visible",
          boxInvalid && "border border-error-primary",
        )}
      >
        <div className="flex items-center gap-4 px-3 py-2 bg-elevation-level-3 rounded-t-[8px] border-b border-muted">
          <div
            className={cn(
              "flex-1 min-w-0 truncate",
              isMobile ? "label-medium" : "label-small",
              boxInvalid ? "text-error-primary" : "text-basic-primary",
            )}
          >
            Configurations
          </div>
          <SourceMenu
            label={sourceLabel}
            configurations={configurations.map((entry) => ({
              id: entry.config_id,
              name: entry.name,
            }))}
            activeId={configId}
            source={source.kind}
            onSelect={switchSource}
            onDelete={(id, label) => void onDelete(id, label)}
          />
        </div>
        <Separator />

        <div className="flex flex-col gap-4 md:gap-2 p-3">
          {source.kind === "catalog" ? (
            <>
              <ConfigRow
                label="Model"
                required
                verticalOnMobile
                hint="Every model this build knows about; picking one names its provider."
                control={
                  <CatalogModelPicker
                    catalog={catalog.data}
                    loading={catalog.isLoading}
                    failed={catalog.isError}
                    value={catalogPick}
                    onSelect={(pick) => {
                      setCatalogPick(pick);
                      setApiKey("");
                      setNameDraft(null);
                    }}
                  />
                }
              />
              {catalogPick ? (
                <>
                  <Separator />
                  <ConfigRow
                    label="Base URL"
                    hint="Endpoint the catalog names for this provider."
                    verticalOnMobile
                    control={
                      <Input
                        inputSize={
                          isMobile ? InputSize.Large : InputSize.Medium
                        }
                        className={CONTROL_WIDTH}
                        value={catalogPick.baseUrl}
                        isDisabled
                        readOnly
                      />
                    }
                  />
                  {needsKey ? (
                    <>
                      <Separator />
                      {catalogCredential ? (
                        <ConfigRow
                          label="Credential"
                          verticalOnMobile
                          hint="This provider's conventional environment variable is set on the server; the session reuses it."
                          control={
                            <div className="flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4">
                              <Icon
                                iconName={IconName.CheckCircle}
                                className="text-success-primary"
                              />
                              <span className="label-small text-success-primary">
                                Detected
                              </span>
                            </div>
                          }
                        />
                      ) : (
                        <>
                          <ConfigRow
                            label="Name"
                            required
                            verticalOnMobile
                            hint="How this setup is listed the next time a session is created."
                            control={
                              <Input
                                inputSize={
                                  isMobile ? InputSize.Large : InputSize.Medium
                                }
                                className={CONTROL_WIDTH}
                                value={name}
                                onChange={(event) =>
                                  setNameDraft(event.target.value)
                                }
                              />
                            }
                          />
                          <Separator />
                          <ConfigRow
                            label="API Key"
                            required
                            verticalOnMobile
                            invalid={keyInvalid}
                            hint={
                              catalogProvider?.auth_hint
                                ? `Stored in NAC once the setup is saved, or set ${catalogProvider.auth_hint} on the server instead.`
                                : "Stored in NAC under a generated name once the setup is saved."
                            }
                            control={
                              <Input
                                inputSize={
                                  isMobile ? InputSize.Large : InputSize.Medium
                                }
                                className={CONTROL_WIDTH}
                                type="password"
                                autoComplete="off"
                                placeholder="Paste the provider key"
                                leadingSlot={
                                  <KeyStatus status={validation.status} />
                                }
                                validation={keyInvalid}
                                value={apiKey}
                                onChange={(event) =>
                                  setApiKey(event.target.value)
                                }
                              />
                            }
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Separator />
                      <AuthenticationRow backend={backend} />
                    </>
                  )}
                </>
              ) : null}
            </>
          ) : null}

          {source.kind === "file" ? (
            <>
              <ConfigRow
                label="Config File"
                required
                hint="A config.toml on this machine; its [model] section is read."
                invalid={Boolean(resolveError)}
                verticalOnMobile
                control={
                  <Input
                    inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                    className={CONTROL_WIDTH}
                    placeholder="Select Config File"
                    trailing={InputTrailing.Button}
                    trailingIconName={IconName.Folder}
                    trailingOnClick={() => setPicking(true)}
                    value={filePath}
                    onChange={(event) => setFilePath(event.target.value)}
                  />
                }
              />
              {filePath.trim() ? <Separator /> : null}
            </>
          ) : null}

          {source.kind === "new" ? (
            <>
              <ConfigRow
                label="Provider"
                required
                hint="Which provider the session talks to, and how it authenticates."
                control={
                  <SmallSelect
                    items={PROVIDER_ITEMS}
                    value={provider}
                    onValueChange={(id) => {
                      setProvider(id as ProviderChoice);
                      setApiKey("");
                      setDefaultModel("");
                    }}
                  />
                }
              />
              <Separator />
              {provider === CUSTOM ? (
                <>
                  <ConfigRow
                    label="Protocol"
                    required
                    hint="Wire format the endpoint speaks; a URL alone cannot say."
                    control={
                      <SmallSelect
                        items={PROTOCOL_ITEMS}
                        value={protocol}
                        onValueChange={(id) => setProtocol(id as BackendKind)}
                      />
                    }
                  />
                  <Separator />
                </>
              ) : null}
              <ConfigRow
                label="Name"
                required
                hint="How this setup is listed the next time a session is created."
                control={
                  <Input
                    inputSize={InputSize.Medium}
                    className={CONTROL_WIDTH}
                    value={name}
                    onChange={(event) => setNameDraft(event.target.value)}
                  />
                }
              />
              {!needsKey && provider !== CUSTOM ? (
                <>
                  <Separator />
                  <AuthenticationRow backend={backend} />
                </>
              ) : null}
              {needsKey ? (
                <>
                  <Separator />
                  <ConfigRow
                    label="API Key"
                    required
                    invalid={keyInvalid}
                    hint="Stored in NAC under a generated name once the setup is saved."
                    control={
                      <Input
                        inputSize={InputSize.Medium}
                        className={CONTROL_WIDTH}
                        type="password"
                        autoComplete="off"
                        placeholder="Paste the provider key"
                        leadingSlot={<KeyStatus status={validation.status} />}
                        validation={keyInvalid}
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    }
                  />
                </>
              ) : null}
              {provider === CUSTOM ? (
                <>
                  <Separator />
                  <ConfigRow
                    label="Model"
                    required
                    hint="Model identifier the endpoint expects."
                    control={
                      <Input
                        inputSize={InputSize.Medium}
                        className={CONTROL_WIDTH}
                        placeholder="gpt-5.5"
                        value={modelDraft}
                        onChange={(event) => setModelDraft(event.target.value)}
                      />
                    }
                  />
                  <Separator />
                  <ConfigRow
                    label="Base URL"
                    required
                    hint="Endpoint the session sends its requests to."
                    control={
                      <Input
                        inputSize={InputSize.Medium}
                        className={CONTROL_WIDTH}
                        placeholder="https://api.openai.com/v1"
                        value={baseUrlDraft}
                        onChange={(event) =>
                          setBaseUrlDraft(event.target.value)
                        }
                      />
                    }
                  />
                </>
              ) : !needsKey ? (
                signedIn ? (
                  <>
                    <Separator />
                    <ConfigRow
                      label="Default Model"
                      hint="Model the session starts with; the login reaches all of these."
                      invalid={Boolean(modelListError)}
                      control={
                        <SmallSelect
                          items={modelListError ? [] : modelItems(models)}
                          value={modelListError ? "" : chosenModel}
                          onValueChange={setDefaultModel}
                          disabled={Boolean(modelListError)}
                          placeholder={
                            loginQuery.isFetching
                              ? "Reading the model list…"
                              : modelListError
                                ? "–"
                                : "No models offered"
                          }
                        />
                      }
                    />
                  </>
                ) : null
              ) : validation.status === "ready" ? (
                <>
                  <Separator />
                  <ConfigRow
                    label="Default Model"
                    hint="Model the session starts with; the key reaches all of these."
                    control={
                      <SmallSelect
                        items={modelItems(validation.models)}
                        value={chosenModel}
                        onValueChange={setDefaultModel}
                        placeholder="No models offered"
                      />
                    }
                  />
                </>
              ) : null}
            </>
          ) : null}

          {source.kind === "saved" || source.kind === "file" ? (
            <ResolvedRows
              resolving={resolving}
              resolved={resolved}
              backend={savedBackend}
              onBackend={setBackendOverride}
              baseUrl={savedBaseUrl}
              onBaseUrl={setBaseUrlOverride}
              model={chosenModel}
              onModel={(value) =>
                resolved?.models.length
                  ? setDefaultModel(value)
                  : setModelOverride(value)
              }
              failed={Boolean(resolveError)}
            />
          ) : null}

          {children && credentialReady ? (
            <>
              <Separator />
              {children}
            </>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="flex items-start gap-2">
          <p className="label-micro text-error-primary flex-1 min-w-0">
            {message}
          </p>
          {retry ? (
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Medium}
              content={ButtonContent.Text}
              onClick={() => void retry()}
            >
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-micro text-basic-muted">* Required fields</p>

      <PathPickerModal
        open={picking}
        kind="toml"
        initialPath={filePath.trim()}
        onClose={() => setPicking(false)}
        onSelect={(path) => {
          setFilePath(path);
          setPicking(false);
        }}
      />
    </div>
  );
}
