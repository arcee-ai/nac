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
  Loader,
  LoaderSize,
  Popover,
  PopoverPlacement,
  Select,
  type SelectItem,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { ConfigDivider, ConfigRow } from "@/app/components/modals/ConfigRow";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { cn } from "@/app/lib/cn";
import { PROVIDER_KINDS, providerLabel, providerUsesApiKey } from "@/app/lib/providers";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useDeleteModelConfig,
  useModelConfigs,
  useProviderModels,
  useResolvedModelConfig,
} from "@/app/services/queries";
import type {
  BackendKind,
  CreateModelConfigurationRequest,
  ProviderModel,
  ResolvedModelConfiguration,
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

type Source =
  | { kind: "new" }
  | { kind: "file" }
  | { kind: "saved"; configId: string };

/** A base URL the user writes by hand, for a gateway nac has no defaults for. */
const CUSTOM = "custom";
type ProviderChoice = BackendKind | typeof CUSTOM;

const PROVIDER_ITEMS: SelectItem[] = [
  ...PROVIDER_KINDS.map((kind) => ({ id: kind, label: providerLabel(kind) })),
  { id: CUSTOM, label: "Custom" },
];

const PROTOCOL_ITEMS: SelectItem[] = PROVIDER_KINDS.map((kind) => ({
  id: kind,
  label: providerLabel(kind),
}));

const CONTROL_WIDTH = "w-[220px]";

/** Long enough to stop firing on every keystroke of a pasted key. */
const KEY_DEBOUNCE_MS = 600;
const PATH_DEBOUNCE_MS = 400;

/** Stored keys never leave the server, so a saved setup only shows a stand-in. */
const MASKED_KEY = "*".repeat(32);

type Validation =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "ready"; models: ProviderModel[]; baseUrl: string }
  | { status: "error"; message: string };

function modelItems(models: ProviderModel[]): SelectItem[] {
  return models.map((model) => ({
    id: model.id,
    label: model.display_name ?? model.id,
  }));
}

/** Green tick, spinner or key, depending on how the key checked out. */
function KeyStatus({ status }: { status: Validation["status"] }) {
  if (status === "validating") return <Loader size={LoaderSize.Micro} />;
  if (status === "ready") {
    return (
      <Icon
        iconName={IconName.CheckCircle}
        size={16}
        className="text-success-primary"
      />
    );
  }
  return (
    <Icon
      iconName={IconName.Key}
      size={16}
      className={cn(status === "error" ? "text-error-primary" : "text-basic-muted")}
    />
  );
}

/**
 * Picks the provider setup a new session launches with: a fresh one, a setup
 * saved earlier, or one read out of a `config.toml`.
 *
 * A key is checked by listing the models it can reach, which is also where the
 * default model choices come from — the same request answers both questions.
 * Keys are handed to the server only to be validated, and are persisted solely
 * as part of saving a named configuration.
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
  const deleteConfig = useDeleteModelConfig();
  const configurations = useMemo(() => saved?.configurations ?? [], [saved]);

  const [source, setSource] = useState<Source>({ kind: "new" });
  const [provider, setProvider] = useState<ProviderChoice>("openai-responses");
  const [protocol, setProtocol] = useState<BackendKind>("openai-responses");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [filePath, setFilePath] = useState("");
  const [picking, setPicking] = useState(false);

  const backend: BackendKind = provider === CUSTOM ? protocol : provider;
  const needsKey = providerUsesApiKey(backend);
  // A hand-written gateway may not implement a model index, so its model and
  // URL are typed in rather than discovered.
  const discovers = provider !== CUSTOM && needsKey;

  const autoName = useMemo(() => {
    const base = provider === CUSTOM ? "custom" : provider;
    const taken = new Set(configurations.map((entry) => entry.name));
    for (let index = 1; ; index += 1) {
      const candidate = `${base}-config-${index}`;
      if (!taken.has(candidate)) return candidate;
    }
  }, [provider, configurations]);
  const name = nameDraft ?? autoName;

  const debouncedKey = useDebouncedValue(apiKey.trim(), KEY_DEBOUNCE_MS);
  const debouncedPath = useDebouncedValue(filePath.trim(), PATH_DEBOUNCE_MS);

  const configId = source.kind === "saved" ? source.configId : null;
  const configFile = source.kind === "file" ? debouncedPath : "";

  const keyQuery = useProviderModels(
    backend,
    debouncedKey,
    null,
    source.kind === "new" && discovers,
  );
  const configQuery = useResolvedModelConfig(configId, configFile);

  const validation: Validation = !(source.kind === "new" && discovers && debouncedKey)
    ? { status: "idle" }
    : keyQuery.isFetching
      ? { status: "validating" }
      : keyQuery.error
        ? { status: "error", message: errorMessage(keyQuery.error) }
        : keyQuery.data
          ? { status: "ready", models: keyQuery.data.models, baseUrl: keyQuery.data.base_url }
          : { status: "validating" };

  const keyValidated = validation.status === "ready";
  const validatedBaseUrl = keyQuery.data?.base_url ?? "";

  const resolvedTarget = Boolean(configId ?? configFile);
  const resolving = resolvedTarget && configQuery.isFetching;
  const resolved = resolvedTarget && !configQuery.error ? (configQuery.data ?? null) : null;
  const resolveError =
    resolvedTarget && configQuery.error ? errorMessage(configQuery.error) : "";

  // Derived rather than stored, so a stale pick never survives a source change.
  const models = source.kind === "new" ? (keyQuery.data?.models ?? []) : (resolved?.models ?? []);
  const configuredModel = source.kind === "new" ? "" : (resolved?.model ?? "");
  const chosenModel = models.some((model) => model.id === defaultModel)
    ? defaultModel
    : models.some((model) => model.id === configuredModel)
      ? configuredModel
      : (models[0]?.id ?? configuredModel);

  const switchSource = (next: Source) => {
    setSource(next);
    setApiKey("");
    setDefaultModel("");
    if (next.kind !== "file") setFilePath("");
    if (next.kind !== "new") setNameDraft(null);
  };

  const savedRecord = configId
    ? (configurations.find((entry) => entry.config_id === configId) ?? null)
    : null;

  const selection = useMemo<LaunchModelSelection | null>(() => {
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
        const model = modelDraft.trim();
        if (!model) return null;
        return { kind: "save", request: { name: trimmedName, backend, model } };
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

    if (!resolved) return null;
    const model = chosenModel || resolved.model || "";
    if (!model) return null;
    return {
      kind: "resolved",
      backend: resolved.backend,
      model,
      base_url: resolved.base_url,
      api_key_env: resolved.api_key_env,
      reasoning_effort: resolved.reasoning_effort,
      extra_headers: savedRecord?.extra_headers ?? null,
    };
  }, [
    source.kind,
    name,
    apiKey,
    needsKey,
    provider,
    backend,
    baseUrlDraft,
    modelDraft,
    keyValidated,
    validatedBaseUrl,
    chosenModel,
    resolved,
    savedRecord,
  ]);

  useEffect(() => {
    onChange(selection);
  }, [selection, onChange]);

  const onDelete = async (id: string, label: string) => {
    try {
      await deleteConfig.mutateAsync(id);
      if (configId === id) switchSource({ kind: "new" });
      toast.success(`Configuration ${label} removed`);
    } catch (error) {
      toast.error(`Failed to remove the configuration: ${errorMessage(error)}`);
    }
  };

  const keyInvalid = validation.status === "error";
  const boxInvalid = invalid || keyInvalid || Boolean(resolveError);
  const message = errorText ?? (keyInvalid ? validation.message : resolveError);

  const sourceLabel =
    source.kind === "new"
      ? "Create New"
      : source.kind === "file"
        ? "From a .toml file"
        : (savedRecord?.name ?? "Configuration");

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex flex-col rounded-[8px] bg-input shadow-concave overflow-visible",
          boxInvalid && "border border-error-primary",
        )}
      >
        <div className="flex items-center gap-4 px-3 py-2">
          <div
            className={cn(
              "label-small flex-1 min-w-0 truncate",
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
        <ConfigDivider />

        <div className="flex flex-col gap-2 px-3 py-2">
          {source.kind === "file" ? (
            <>
              <ConfigRow
                label="Config File"
                required
                hint="A config.toml on this machine; its [model] section is read."
                invalid={Boolean(resolveError)}
                control={
                  <Input
                    inputSize={InputSize.Small}
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
              {filePath.trim() ? <ConfigDivider /> : null}
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
              <ConfigDivider />
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
                  <ConfigDivider />
                </>
              ) : null}
              <ConfigRow
                label="Name"
                required
                hint="How this setup is listed the next time a session is created."
                control={
                  <Input
                    inputSize={InputSize.Small}
                    className={CONTROL_WIDTH}
                    value={name}
                    onChange={(event) => setNameDraft(event.target.value)}
                  />
                }
              />
              {needsKey ? (
                <>
                  <ConfigDivider />
                  <ConfigRow
                    label="API Key"
                    required
                    invalid={keyInvalid}
                    hint="Stored in NAC under a generated name once the setup is saved."
                    control={
                      <Input
                        inputSize={InputSize.Small}
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
                  <ConfigDivider />
                  <ConfigRow
                    label="Model"
                    required
                    hint="Model identifier the endpoint expects."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className={CONTROL_WIDTH}
                        placeholder="gpt-5.5"
                        value={modelDraft}
                        onChange={(event) => setModelDraft(event.target.value)}
                      />
                    }
                  />
                  <ConfigDivider />
                  <ConfigRow
                    label="Base URL"
                    required
                    hint="Endpoint the session sends its requests to."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className={CONTROL_WIDTH}
                        placeholder="https://api.openai.com/v1"
                        value={baseUrlDraft}
                        onChange={(event) => setBaseUrlDraft(event.target.value)}
                      />
                    }
                  />
                </>
              ) : !needsKey ? (
                <>
                  <ConfigDivider />
                  <ConfigRow
                    label="Model"
                    required
                    hint="This provider signs in with a stored login, so it lists no models."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className={CONTROL_WIDTH}
                        placeholder="gpt-5.5"
                        value={modelDraft}
                        onChange={(event) => setModelDraft(event.target.value)}
                      />
                    }
                  />
                </>
              ) : validation.status === "ready" ? (
                <>
                  <ConfigDivider />
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

          {source.kind !== "new" ? (
            <ResolvedRows
              resolving={resolving}
              resolved={resolved}
              defaultModel={chosenModel}
              onDefaultModel={setDefaultModel}
              failed={Boolean(resolveError)}
            />
          ) : null}

          {children ? (
            <>
              <ConfigDivider />
              {children}
            </>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="flex items-start gap-2">
          <p className="label-micro text-error-primary flex-1 min-w-0">{message}</p>
          {resolveError ? (
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Small}
              content={ButtonContent.Text}
              onClick={() => void configQuery.refetch()}
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

/** Provider, key and model of a configuration the server already resolved. */
function ResolvedRows({
  resolving,
  resolved,
  defaultModel,
  onDefaultModel,
  failed,
}: {
  resolving: boolean;
  resolved: ResolvedModelConfiguration | null;
  defaultModel: string;
  onDefaultModel: (id: string) => void;
  failed: boolean;
}) {
  if (resolving) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader size={LoaderSize.Micro} />
        <span className="text-micro text-basic-muted">
          Checking the key and reading the model list…
        </span>
      </div>
    );
  }
  if (!resolved) {
    return failed ? null : (
      <p className="text-micro text-basic-muted py-1">
        Pick a configuration to see its provider and models.
      </p>
    );
  }

  const usesKey = providerUsesApiKey(resolved.backend);
  return (
    <>
      <ConfigRow
        label="Provider"
        required
        control={
          <div className={cn(CONTROL_WIDTH, "text-right label-micro text-basic-secondary truncate")}>
            {providerLabel(resolved.backend)}
          </div>
        }
      />
      {usesKey ? (
        <>
          <ConfigDivider />
          <ConfigRow
            label="API Key"
            required
            control={
              <Input
                inputSize={InputSize.Small}
                className={CONTROL_WIDTH}
                value={MASKED_KEY}
                isDisabled
                readOnly
                leadingSlot={<KeyStatus status="ready" />}
              />
            }
          />
        </>
      ) : null}
      <ConfigDivider />
      <ConfigRow
        label="Default Model"
        hint="Model the session starts with."
        control={
          resolved.models.length > 0 ? (
            <SmallSelect
              items={modelItems(resolved.models)}
              value={defaultModel}
              onValueChange={onDefaultModel}
            />
          ) : (
            <div className={cn(CONTROL_WIDTH, "text-right label-micro text-basic-secondary truncate")}>
              {defaultModel || resolved.model || "—"}
            </div>
          )
        }
      />
    </>
  );
}

function SmallSelect({
  items,
  value,
  onValueChange,
  placeholder,
}: {
  items: SelectItem[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      size={ButtonSize.Small}
      variant={ButtonVariant.Ghost}
      placement={PopoverPlacement.BottomLeft}
      className="max-w-[220px]"
      panelClassName="max-h-64 overflow-auto min-w-[220px]"
    />
  );
}

/** Create a setup, read one from a file, or reuse one saved earlier. */
function SourceMenu({
  label,
  configurations,
  activeId,
  source,
  onSelect,
  onDelete,
}: {
  label: string;
  configurations: { id: string; name: string }[];
  activeId: string | null;
  source: Source["kind"];
  onSelect: (source: Source) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const pick = (next: Source) => {
    onSelect(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.BottomLeft}
      size="min-w-[260px]"
      className="shrink-0"
      panelClassName="max-h-72 overflow-auto"
      content={
        <>
          <TabButton
            size={TabButtonSize.Small}
            variant={source === "new" ? TabButtonVariant.Accent : TabButtonVariant.Regular}
            active={source === "new"}
            onClick={() => pick({ kind: "new" })}
          >
            <Icon iconName={IconName.Add} />
            <span className="text-left flex-grow">Create New</span>
          </TabButton>
          <TabButton
            size={TabButtonSize.Small}
            variant={source === "file" ? TabButtonVariant.Accent : TabButtonVariant.Regular}
            active={source === "file"}
            onClick={() => pick({ kind: "file" })}
          >
            <Icon iconName={IconName.File} />
            <span className="text-left flex-grow">From a .toml file</span>
          </TabButton>
          {configurations.length > 0 ? (
            <div className="h-px w-full bg-divider-muted my-1" />
          ) : null}
          {configurations.map((entry) => (
            <div key={entry.id} className="flex items-center gap-1">
              <TabButton
                size={TabButtonSize.Small}
                variant={
                  activeId === entry.id ? TabButtonVariant.Accent : TabButtonVariant.Regular
                }
                active={activeId === entry.id}
                className="flex-1 min-w-0"
                onClick={() => pick({ kind: "saved", configId: entry.id })}
              >
                <Icon iconName={IconName.Gear} />
                <span className="text-left flex-grow truncate">{entry.name}</span>
              </TabButton>
              <Button
                variant={ButtonVariant.TertiaryDestructive}
                size={ButtonSize.Small}
                content={ButtonContent.Icon}
                aria-label={`Remove ${entry.name}`}
                onClick={() => onDelete(entry.id, entry.name)}
              >
                <Icon iconName={IconName.Trash} />
              </Button>
            </div>
          ))}
        </>
      }
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Small}
        content={ButtonContent.IconRight}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="text-left flex-grow truncate max-w-[220px]">{label}</span>
        <Icon
          iconName={IconName.Down}
          className={cn(
            "transition-transform duration-300 ease-in-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </Button>
    </Popover>
  );
}
