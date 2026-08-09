import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  type SelectItem,
  Separator,
  StickyButton,
  TextArea,
} from "@/app/atoms";
import { AuthenticationRow } from "@/app/components/modals/AuthenticationRow";
import { ConfigListNav } from "@/app/components/modals/ConfigListNav";
import { ConfigRow } from "@/app/components/modals/ConfigRow";
import { KeyStatus } from "@/app/components/modals/KeyStatus";
import {
  MixedModelsSection,
  type MixedSelection,
} from "@/app/components/modals/MixedModelsSection";
import {
  REASONING_OPTIONS,
  reasoningOptionsFor,
} from "@/app/components/modals/options";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useManagedSignIn } from "@/app/hooks/useManagedSignIn";
import {
  KEY_DEBOUNCE_MS,
  MASKED_KEY,
  modelItems,
  type Validation,
} from "@/app/lib/apiKey";
import { cn } from "@/app/lib/cn";
import { CLEAR_EFFORT, serializeExtraHeaders } from "@/app/lib/modelConfig";
import {
  PROVIDER_KINDS,
  providerLabel,
  providerUsesApiKey,
} from "@/app/lib/providers";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCreateModelConfig,
  useDeleteModelConfig,
  useManagedProviderModels,
  useModelCatalog,
  useModelConfigs,
  useProviderModels,
  useResolvedModelConfig,
  useUpdateModelConfig,
} from "@/app/services/queries";
import type {
  BackendKind,
  ModelConfigurationRecord,
  UpdateModelConfigurationRequest,
} from "@/app/types/api";

const PROVIDER_ITEMS: SelectItem[] = PROVIDER_KINDS.map((kind) => ({
  id: kind,
  label: providerLabel(kind),
}));

/**
 * A stored setup either names an effort or leaves it to the config file, so
 * there is no configured value here for "clear" to act on.
 */
const REASONING_ITEMS: SelectItem[] = REASONING_OPTIONS.filter(
  (item) => item.id !== CLEAR_EFFORT,
).map((item) => (item.id === "" ? { ...item, label: "Not set" } : item));

/** Sentinel for the sidebar entry that builds a setup instead of editing one. */
const DRAFT = "__new__";

/**
 * Manages the saved provider setups: the sidebar picks one, the form edits it
 * in place, and the footer saves, discards or removes it.
 *
 * Remounted on every open so a half-finished edit never survives a close.
 */
export function ConfigurationsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return <ConfigurationsManager open={open} onClose={onClose} />;
}

function ConfigurationsManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { data, isLoading } = useModelConfigs();
  const configurations = useMemo(() => data?.configurations ?? [], [data]);
  const [footer, setFooter] = useState<ReactNode>(null);

  // Null until the user picks, so the default below can still settle once the
  // list arrives. The server orders by creation, hence the last entry.
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? configurations.at(-1)?.config_id ?? DRAFT;
  const record =
    configurations.find((entry) => entry.config_id === selected) ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configurations"
      size={ModalSize.Large}
      flush
      className="max-w-[820px] md:h-[720px]"
      bodyClassName="p-0 overflow-hidden"
      footer={footer}
    >
      <div className="flex flex-col md:flex-row items-stretch h-full min-h-0">
        <ConfigListNav
          draftLabel="New configuration"
          draftSelected={selected === DRAFT}
          onSelectDraft={() => setPicked(DRAFT)}
          entries={configurations.map((entry) => ({
            id: entry.config_id,
            name: entry.name,
          }))}
          selectedId={selected}
          onSelect={setPicked}
          isLoading={isLoading}
        />

        <ConfigurationForm
          key={selected}
          record={record}
          takenNames={configurations
            .filter((entry) => entry.config_id !== selected)
            .map((entry) => entry.name)}
          onClose={onClose}
          onSaved={setPicked}
          onDeleted={() => setPicked(null)}
          setFooter={setFooter}
          isMobile={isMobile}
        />
      </div>
    </Modal>
  );
}

/**
 * One setup's fields. Mounted fresh per selection, so the drafts below start
 * from what is stored and a switch never carries an edit across.
 *
 * A key is checked by listing the models it can reach, which is also where the
 * model choices come from — the same request answers both questions. A stored
 * key never comes back from the server, so leaving the field blank keeps it.
 */
function ConfigurationForm({
  record,
  takenNames,
  onClose,
  onSaved,
  onDeleted,
  setFooter,
  isMobile,
}: {
  record: ModelConfigurationRecord | null;
  takenNames: string[];
  onClose: () => void;
  onSaved: (configId: string) => void;
  onDeleted: () => void;
  setFooter: (footer: ReactNode) => void;
  isMobile: boolean;
}) {
  const toast = useToast();
  const createConfig = useCreateModelConfig();
  const updateConfig = useUpdateModelConfig();
  const deleteConfig = useDeleteModelConfig();

  const stored = record?.backend as BackendKind | undefined;
  const [backend, setBackend] = useState<BackendKind>(
    stored ?? "openai-responses",
  );
  // Null follows the suggestion below, which tracks the provider until the
  // user writes a name of their own.
  const [nameDraft, setNameDraft] = useState<string | null>(
    record?.name ?? null,
  );
  const [baseUrl, setBaseUrl] = useState(record?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(record?.model ?? "");
  const [reasoning, setReasoning] = useState(record?.reasoning_effort ?? "");
  const [compaction, setCompaction] = useState(
    record?.orchestrator_compaction_threshold?.toString() ?? "",
  );
  const [headers, setHeaders] = useState(() =>
    record && Object.keys(record.extra_headers).length
      ? JSON.stringify(record.extra_headers, null, 2)
      : "",
  );
  const [prompt, setPrompt] = useState(record?.initial_prompt ?? "");
  const [mixed, setMixed] = useState<MixedSelection>({
    mode: record?.mixed_models ? "mixed" : "single",
    mixed: record?.mixed_models ?? null,
  });
  const [error, setError] = useState("");

  const name = nameDraft ?? autoName(backend, takenNames);
  const needsKey = providerUsesApiKey(backend);
  // The catalog knows which efforts this model takes; the rest would only be
  // saved for the backend to reject at launch.
  const catalog = useModelCatalog();
  const reasoningItems = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, backend, model).supportedEfforts,
    reasoning,
    REASONING_ITEMS,
  );
  const { signedIn } = useManagedSignIn(backend);
  const debouncedKey = useDebouncedValue(apiKey.trim(), KEY_DEBOUNCE_MS);
  // A saved setup keeps its key on the server; only a key typed here is ours
  // to check, and checking it is also how the model list refreshes.
  const keyQuery = useProviderModels(
    backend,
    debouncedKey,
    null,
    needsKey && Boolean(debouncedKey),
  );
  const loginQuery = useManagedProviderModels(backend, !needsKey && signedIn);
  // Only the stored provider's models describe the stored setup; switching
  // provider retires them until a key or login answers for the new one.
  const savedQuery = useResolvedModelConfig(
    record && backend === stored ? record.config_id : null,
    "",
  );

  const validation: Validation = !(needsKey && debouncedKey)
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

  const models =
    keyQuery.data?.models ??
    loginQuery.data?.models ??
    savedQuery.data?.models ??
    [];
  const chosenModel = models.some((entry) => entry.id === model)
    ? model
    : (model ?? "");

  // A saved key is present but unreadable, so the field stands in for it and
  // only reports a status once the user starts replacing it.
  const keyStatus: Validation["status"] =
    validation.status !== "idle"
      ? validation.status
      : record?.api_key_env
        ? "ready"
        : "idle";

  const busy =
    createConfig.isPending || updateConfig.isPending || deleteConfig.isPending;

  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setError("");
      setter(value);
    };

  const save = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }
    if (!chosenModel.trim()) {
      setError("A model is required.");
      return;
    }

    let extraHeaders: Record<string, string>;
    try {
      extraHeaders = serializeExtraHeaders(headers, {});
    } catch (headerError) {
      setError(errorMessage(headerError));
      return;
    }

    const threshold = compaction.trim() ? Number(compaction.trim()) : 0;
    if (!Number.isSafeInteger(threshold) || threshold < 0) {
      setError(
        "The compaction threshold must be a whole number, or 0 to disable it.",
      );
      return;
    }

    if (mixed.mode === "mixed" && !mixed.mixed) {
      setError("Complete the easy, medium and hard tiers before saving.");
      return;
    }
    const mixedModels = mixed.mode === "mixed" ? mixed.mixed : null;

    try {
      if (record) {
        const patch: UpdateModelConfigurationRequest = {
          name: name.trim(),
          backend,
          model: chosenModel.trim(),
          reasoning_effort: reasoning || null,
          extra_headers: extraHeaders,
          orchestrator_compaction_threshold: threshold,
          initial_prompt: prompt.trim() || null,
          mixed_models: mixedModels,
        };
        // Omitted keeps what is stored, which is the only way to leave a
        // credential or a hand-written gateway URL alone.
        if (apiKey.trim()) patch.api_key = apiKey.trim();
        if (baseUrl.trim()) patch.base_url = baseUrl.trim();
        const saved = await updateConfig.mutateAsync({
          configId: record.config_id,
          payload: patch,
        });
        onSaved(saved.config_id);
        toast.success(`Configuration ${saved.name} saved`);
      } else {
        const saved = await createConfig.mutateAsync({
          name: name.trim(),
          backend,
          model: chosenModel.trim(),
          base_url: baseUrl.trim() || null,
          api_key: needsKey ? apiKey.trim() : null,
          reasoning_effort: reasoning || null,
          extra_headers: extraHeaders,
          orchestrator_compaction_threshold: threshold,
          initial_prompt: prompt.trim() || null,
          mixed_models: mixedModels,
        });
        onSaved(saved.config_id);
        toast.success(`Configuration ${saved.name} created`);
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const remove = async () => {
    if (!record || busy) return;
    try {
      await deleteConfig.mutateAsync(record.config_id);
      onDeleted();
      toast.success(`Configuration ${record.name} removed`);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    }
  };

  const saveRef = useRef(save);
  const removeRef = useRef(remove);

  useLayoutEffect(() => {
    saveRef.current = save;
    removeRef.current = remove;
  });

  useLayoutEffect(() => {
    const saving = createConfig.isPending || updateConfig.isPending;
    setFooter(
      <>
        {record ? (
          isMobile ? (
            <StickyButton
              variant={ButtonVariant.SecondaryDestructive}
              content={ButtonContent.Icon}
              className="mr-auto"
              disabled={busy}
              loading={deleteConfig.isPending}
              onClick={() => void removeRef.current()}
            >
              <Icon iconName={IconName.Trash} />
            </StickyButton>
          ) : (
            <Button
              variant={ButtonVariant.SecondaryDestructive}
              size={ButtonSize.Large}
              content={ButtonContent.Icon}
              className="mr-auto"
              disabled={busy}
              loading={deleteConfig.isPending}
              onClick={() => void removeRef.current()}
            >
              <Icon iconName={IconName.Trash} />
            </Button>
          )
        ) : null}
        {isMobile ? (
          <StickyButton
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={onClose}
          >
            Cancel
          </StickyButton>
        ) : (
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            onClick={onClose}
          >
            Cancel
          </Button>
        )}
        {isMobile ? (
          <StickyButton
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            disabled={busy}
            loading={saving}
            onClick={() => void saveRef.current()}
          >
            Save
          </StickyButton>
        ) : (
          <Button
            variant={ButtonVariant.Primary}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            disabled={busy}
            loading={saving}
            onClick={() => void saveRef.current()}
          >
            Save
          </Button>
        )}
      </>,
    );
    return () => setFooter(null);
  }, [
    busy,
    createConfig.isPending,
    deleteConfig.isPending,
    isMobile,
    onClose,
    record,
    setFooter,
    updateConfig.isPending,
  ]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
          isMobile && "pb-[88px]",
        )}
      >
        <div className="flex flex-col md:rounded-[8px] md:bg-elevation-level-2 md:border md:border-muted md:p-3 gap-4 md:gap-2">
          <ConfigRow
            label="Provider"
            required
            hint="Which provider the session talks to, and how it authenticates."
            control={
              <SmallSelect
                items={PROVIDER_ITEMS}
                value={backend}
                onValueChange={(id) => {
                  edit(setBackend)(id as BackendKind);
                  setApiKey("");
                  setModel("");
                }}
              />
            }
          />
          <Separator />
          <ConfigRow
            label="Name"
            required
            hint="How this setup is listed the next time a session is created."
            verticalOnMobile
            control={
              <Input
                inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                className="w-full md:w-[280px]"
                value={name}
                onChange={(event) => edit(setNameDraft)(event.target.value)}
              />
            }
          />
          <Separator />
          {needsKey ? (
            <ConfigRow
              label="API Key"
              required
              invalid={validation.status === "error"}
              verticalOnMobile
              hint={
                record
                  ? "Held by nac for this configuration; type a new key to replace it."
                  : "Stored in NAC under a generated name once the setup is saved."
              }
              control={
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  className="w-full md:w-[280px]"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    record?.api_key_env ? MASKED_KEY : "Paste the provider key"
                  }
                  leadingSlot={<KeyStatus status={keyStatus} />}
                  validation={validation.status === "error"}
                  value={apiKey}
                  onChange={(event) => edit(setApiKey)(event.target.value)}
                />
              }
            />
          ) : (
            <AuthenticationRow backend={backend} />
          )}
          <Separator />
          <ConfigRow
            label="Base URL"
            hint="Endpoint the session sends its requests to; blank uses the provider's own."
            control={
              <Input
                inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                className="w-full md:w-[280px]"
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={(event) => edit(setBaseUrl)(event.target.value)}
              />
            }
            verticalOnMobile
          />
          <Separator />
          <ConfigRow
            label="Default Model"
            required
            hint="Model sessions started from this setup begin with."
            verticalOnMobile={models.length ? false : true}
            control={
              models.length ? (
                <SmallSelect
                  items={modelItems(models)}
                  value={chosenModel}
                  onValueChange={edit(setModel)}
                  placeholder="No models offered"
                />
              ) : (
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  className="w-full md:w-[280px]"
                  placeholder="gpt-5.5"
                  value={model}
                  onChange={(event) => edit(setModel)(event.target.value)}
                />
              )
            }
          />
          <Separator />
          <ConfigRow
            label="Reasoning"
            hint="Reasoning effort passed to the model."
            control={
              <SmallSelect
                items={reasoningItems}
                value={reasoning}
                onValueChange={edit(setReasoning)}
              />
            }
          />
          <Separator />
          <ConfigRow
            label="Orchestrator compaction threshold"
            verticalOnMobile
            labelClassName="max-w-none"
            hint="Context size that triggers compaction; 0 disables it."
            control={
              <Input
                inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                className="w-full md:w-[105px]"
                inputClassName="text-right"
                placeholder="config.toml"
                inputMode="numeric"
                value={compaction}
                onChange={(event) => edit(setCompaction)(event.target.value)}
              />
            }
          />
          <Separator />
          <MixedModelsSection
            initial={record?.mixed_models ?? null}
            primaryBackend={backend}
            primaryApiKeyEnv={apiKey.trim() ? null : record?.api_key_env}
            onChange={setMixed}
          />
          <Separator />
          <TextArea
            label="Extra headers (JSON object)"
            hintText="Blank sends none; header values must be strings."
            placeholder='{"X-Title": "nac"}'
            value={headers}
            onChange={(event) => edit(setHeaders)(event.target.value)}
            textAreaClassName="h-[108px] resize-none"
          />
          <Separator />
          <TextArea
            label="Initial prompt"
            hintText="Pre-fills the first message of a session started from this setup."
            placeholder="Send a message"
            value={prompt}
            onChange={(event) => edit(setPrompt)(event.target.value)}
            textAreaClassName="h-[92px] resize-none"
          />
        </div>
        {error ? (
          <p className="label-micro text-error-primary pt-2">{error}</p>
        ) : null}
        <p className="text-micro text-basic-muted pt-2">* Required fields</p>
      </div>
    </div>
  );
}

/** First unused `<provider>-config-N`, matching what the launch modal suggests. */
function autoName(backend: BackendKind, taken: string[]): string {
  const names = new Set(taken);
  for (let index = 1; ; index += 1) {
    const candidate = `${backend}-config-${index}`;
    if (!names.has(candidate)) return candidate;
  }
}
