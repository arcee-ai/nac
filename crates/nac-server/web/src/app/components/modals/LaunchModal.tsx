import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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
  PopoverPlacement,
  Select,
  type SelectItem,
  Separator,
  StickyButton,
  Switch,
  SwitchSize,
  TextArea,
} from "@/app/atoms";
import { ConfigRow, FieldLabel } from "@/app/components/modals/ConfigRow";
import {
  ConfigurationsPanel,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import {
  REASONING_OPTIONS,
  reasoningOptionsFor,
} from "@/app/components/modals/options";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import {
  CLEAR_EFFORT,
  csv,
  launchLocationFromValues,
  nullable,
  serializeExtraHeaders,
} from "@/app/lib/modelConfig";
import { humanErrorText } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import {
  useCreateModelConfig,
  useCreateSession,
  useModelCatalog,
  useStoreInfo,
  useUpdatePresentation,
} from "@/app/services/queries";
import type {
  BackendKind,
  CreateSessionRequest,
  SshTarget,
} from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

type Mode = "local" | "ssh" | "sandbox";

const MODES: { id: Mode; label: string }[] = [
  { id: "local", label: "Local" },
  { id: "ssh", label: "SSH" },
  { id: "sandbox", label: "Sandbox" },
];

/** The configuration decides these, so "inherit" means "leave it alone". */
const ADVANCED_REASONING: SelectItem[] = REASONING_OPTIONS.map((item) =>
  item.id === "" ? { ...item, label: "From configuration" } : item,
);

// `.btn-medium.btn-icon-right` wins on specificity, so the inset that lines
// the path up with the neighbouring input has to be inline too.
const CWD_BUTTON_PADDING = { paddingInline: "8px" };

interface SandboxState {
  noMount: boolean;
  image: string;
  gpu: string;
  workdir: string;
  shm: string;
  mounts: string;
}

const EMPTY_SANDBOX: SandboxState = {
  noMount: false,
  image: "",
  gpu: "",
  workdir: "",
  shm: "",
  mounts: "",
};

/** `field` marks which control to flag; "config" flags the whole box. */
interface FormError {
  field: "cwd" | "ssh" | "config";
  message: string;
}

/** Remounted on every open so the form always starts from the configured defaults. */
export function LaunchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: storeInfo } = useStoreInfo();
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return (
    <LaunchForm
      open={open}
      defaultCwd={storeInfo?.root_cwd ?? ""}
      onClose={onClose}
    />
  );
}

function LaunchForm({
  open,
  defaultCwd,
  onClose,
}: {
  open: boolean;
  defaultCwd: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const createSession = useCreateSession();
  const createModelConfig = useCreateModelConfig();
  const updatePresentation = useUpdatePresentation();

  const [mode, setMode] = useState<Mode>("local");
  const [cwd, setCwd] = useState(defaultCwd);
  const [title, setTitle] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [compaction, setCompaction] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [sandbox, setSandbox] = useState<SandboxState>(EMPTY_SANDBOX);
  const [advanced, setAdvanced] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selection, setSelection] = useState<LaunchModelSelection | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  // The host this form has actually reached. Everything remote — the working
  // directory above all — is meaningless until one connection has answered, so
  // the rest of the form waits for it.
  const [connection, setConnection] = useState<SshTarget | null>(null);

  // The override only makes sense for the model the selection settles on, so
  // the catalog narrows it to the efforts that model accepts.
  const catalog = useModelCatalog();
  const chosen =
    selection?.kind === "save" ? selection.request : (selection ?? null);
  const reasoningItems = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, chosen?.backend, chosen?.model)
      .supportedEfforts,
    reasoning,
    ADVANCED_REASONING,
  );

  const isMobile = useIsMobile();
  const isSsh = mode === "ssh";
  const connected = isSsh ? connection : null;
  // A local or sandboxed session has nothing to connect to, so it is ready at once.
  const ready = !isSsh || connected !== null;
  const busy = createSession.isPending || createModelConfig.isPending;

  // Any edit clears the previous attempt's error, which also re-enables submit.
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setError(null);
      setter(value);
    };
  const setSb = (patch: Partial<SandboxState>) => {
    setError(null);
    setSandbox((current) => ({ ...current, ...patch }));
  };

  // Stable, so the panel does not re-emit its selection on every render.
  const onSelection = useCallback((next: LaunchModelSelection | null) => {
    setSelection(next);
    setError((current) => (current?.field === "config" ? null : current));
  }, []);

  // Auto-suggest 70% of the selected model's context window as the compaction
  // threshold. A manually entered value is preserved across model changes —
  // the suggestion only fills the field when it is empty or was itself last
  // auto-suggested.
  const compactionRef = useRef("");
  const compactionAutoRef = useRef(true);
  const compactionPlaceholder = useMemo(() => {
    const resolved = resolveCatalogModel(
      catalog.data,
      chosen?.backend,
      chosen?.model,
    );
    const contextWindow = resolved.contextWindow;
    return contextWindow ? String(Math.round(contextWindow * 0.7)) : "auto";
  }, [catalog.data, chosen?.backend, chosen?.model]);
  useEffect(() => {
    if (
      compactionPlaceholder !== "auto" &&
      (compactionRef.current === "" || compactionAutoRef.current)
    ) {
      compactionAutoRef.current = true;
      compactionRef.current = compactionPlaceholder;
      setCompaction(compactionPlaceholder);
    }
  }, [compactionPlaceholder]);

  const onCompactionChange = (value: string) => {
    setError(null);
    compactionAutoRef.current = false;
    compactionRef.current = value;
    setCompaction(value);
  };

  /** Paths belong to whichever machine runs the session, so they do not carry over. */
  const changeMode = (next: Mode) => {
    if (next === mode) return;
    setError(null);
    setMode(next);
    setConnection(null);
    setCwd(next === "ssh" ? "" : defaultCwd);
  };

  /**
   * The SSH box owns Connect/Disconnect; we only keep the proved target and
   * seed the working directory from the login home it returned.
   */
  const onSshConnectionChange = (
    target: SshTarget | null,
    homePath?: string,
  ) => {
    setError(null);
    setConnection(target);
    if (target) {
      if (homePath) setCwd(homePath);
    } else {
      setCwd("");
    }
  };

  const submit = async () => {
    if (busy) return;
    if (isSsh && !connected) {
      setError({
        field: "ssh",
        message: "Connect to the SSH host before creating a session.",
      });
      return;
    }
    if (!nullable(cwd)) {
      setError({ field: "cwd", message: "A working directory is required." });
      return;
    }
    if (!selection) {
      setError({
        field: "config",
        message:
          "Complete the provider configuration before creating a session.",
      });
      return;
    }

    let headers: Record<string, string> | undefined;
    try {
      headers = serializeExtraHeaders(extraHeaders, undefined);
    } catch (validationError) {
      setError({ field: "config", message: errorMessage(validationError) });
      return;
    }

    let backend: BackendKind;
    let model: string;
    let baseUrl: string;
    let apiKeyEnv: string | null;
    let configuredEffort: string | null;
    try {
      if (selection.kind === "save") {
        const record = await createModelConfig.mutateAsync(selection.request);
        backend = record.backend as BackendKind;
        model = record.model;
        baseUrl = record.base_url;
        apiKeyEnv = record.api_key_env;
        configuredEffort = record.reasoning_effort;
      } else {
        backend = selection.backend;
        model = selection.model;
        baseUrl = selection.base_url;
        apiKeyEnv = selection.api_key_env;
        configuredEffort = selection.reasoning_effort;
        headers = headers ?? selection.extra_headers ?? undefined;
      }
    } catch (saveError) {
      setError({
        field: "config",
        message: `The configuration could not be saved: ${humanErrorText(saveError)}`,
      });
      return;
    }

    const body: CreateSessionRequest = {
      // The connection that answered, rather than what the fields hold now:
      // this is the one already proved to work.
      ...launchLocationFromValues({
        cwd,
        ssh_host: connected?.ssh_host ?? "",
        ssh_port: connected?.ssh_port ? String(connected.ssh_port) : "",
        ssh_identity_file: connected?.ssh_identity_file ?? "",
      }),
      model,
      base_url: baseUrl,
      backend,
      api_key_env: apiKeyEnv,
      reasoning_effort:
        reasoning === CLEAR_EFFORT
          ? null
          : reasoning || configuredEffort || null,
    };
    if (headers !== undefined) body.extra_headers = headers;

    const threshold = nullable(compaction);
    if (threshold !== null)
      body.orchestrator_compaction_threshold = Number(threshold);
    if (!body.ssh_host) {
      body.sandbox = {
        enabled: mode === "sandbox",
        no_mount_cwd: sandbox.noMount,
        image: nullable(sandbox.image),
        gpus: csv(sandbox.gpu),
        workdir: nullable(sandbox.workdir),
        shm_size: nullable(sandbox.shm),
        mounts: csv(sandbox.mounts),
        mounts_ro: [],
      };
    }

    try {
      const snapshot = await createSession.mutateAsync(body);
      const newId = snapshot.metadata.session_id;
      toast.success("Session created");

      // A title is presentation state, so it is applied after creation.
      const wantedTitle = nullable(title);
      if (newId && wantedTitle) {
        try {
          await updatePresentation.mutateAsync({
            id: newId,
            title: wantedTitle,
            pinned: false,
            expectedVersion: 0,
          });
        } catch (renameError) {
          toast.error(
            `Session created, but the title was not saved: ${errorMessage(renameError)}`,
          );
        }
      }

      const prompt = initialPrompt.trim();
      if (newId && prompt) {
        try {
          await api.submitRun(newId, prompt);
        } catch (runError) {
          toast.error(
            `Session created, but the initial run failed: ${humanErrorText(runError, backend)}`,
          );
        }
      }

      if (newId) navigate(routes.session(newId));
      onClose();
    } catch (createError) {
      setError({
        field: "config",
        message: humanErrorText(createError, backend),
      });
    }
  };

  const invalid = (field: FormError["field"]) => error?.field === field;

  const smallSelect = (
    items: SelectItem[],
    value: string,
    onValueChange: (id: string) => void,
    disabled = false,
  ) => (
    <Select
      items={items}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      size={ButtonSize.Medium}
      variant={ButtonVariant.Ghost}
      placement={PopoverPlacement.BottomLeft}
      panelClassName="max-h-64 overflow-auto"
    />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Session"
      size={ModalSize.Wide}
      flush
      className="h-[680px]"
      footer={
        isMobile ? (
          <StickyButton
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
            disabled={Boolean(error) || !selection || !ready}
          >
            Create Session
          </StickyButton>
        ) : (
          <Button
            variant={ButtonVariant.Primary}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
            disabled={Boolean(error) || !selection || !ready}
          >
            Create Session
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-8 md:gap-6 [&>*]:shrink-0">
        <div className="flex flex-col gap-1">
          <FieldLabel
            label="Execution"
            hint="Where the agent runs: on this machine, over SSH, or inside a container."
          />
          <div className="flex items-start gap-3">
            {MODES.map((item) => (
              <Button
                key={item.id}
                variant={
                  mode === item.id
                    ? ButtonVariant.Primary
                    : ButtonVariant.Secondary
                }
                size={ButtonSize.Medium}
                content={ButtonContent.Text}
                onClick={() => changeMode(item.id)}
                aria-pressed={mode === item.id}
                className={`${isMobile ? "!rounded-full" : ""}`}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        {isSsh ? (
          <SshConnectionBox
            mode="launch"
            connection={connection}
            onConnectionChange={onSshConnectionChange}
          />
        ) : null}

        {ready ? (
          <div className="flex flex-col md:flex-row items-start gap-6 md:gap-4">
            <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
              <FieldLabel
                label="Working Directory"
                hint={
                  isSsh
                    ? "Directory on the SSH host the agent works in."
                    : "Project directory the agent works in."
                }
                required
                invalid={invalid("cwd")}
              />
              <Button
                variant={ButtonVariant.Secondary}
                size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
                content={ButtonContent.IconRight}
                className={cn("w-full", invalid("cwd") && "input-validation")}
                style={CWD_BUTTON_PADDING}
                onClick={() => setPicking(true)}
              >
                <span
                  className={cn(
                    "flex-1 min-w-0 truncate text-left font-normal",
                    cwd ? "text-basic-primary" : "text-basic-muted",
                  )}
                >
                  {cwd || "/path/to/project"}
                </span>
                <Icon iconName={IconName.Folder} className="shrink-0" />
              </Button>
              {invalid("cwd") ? (
                <p className="pt-1 text-error-primary text-micro">
                  {error?.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-0 w-full">
              <FieldLabel label="Title (optional)" />
              <Input
                inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                placeholder="Shown on the session card"
                value={title}
                onChange={(e) => edit(setTitle)(e.target.value)}
                className={`${isMobile ? "w-full" : ""}`}
              />
            </div>
          </div>
        ) : null}

        {ready ? (
          <ConfigurationsPanel
            invalid={invalid("config")}
            errorText={invalid("config") ? error?.message : undefined}
            onChange={onSelection}
          >
            <div className="flex flex-col gap-2">
              <ConfigRow
                label="Reasoning effort"
                hint="Reasoning effort passed to the model."
                control={smallSelect(
                  reasoningItems,
                  reasoning,
                  edit(setReasoning),
                )}
              />
              <Separator />
              <ConfigRow
                label="Compaction threshold"
                hint="Context size that triggers compaction; 0 disables it."
                control={
                  <Input
                    inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                    className="w-full md:w-[120px]"
                    inputClassName="md:text-right"
                    placeholder={compactionPlaceholder}
                    inputMode="numeric"
                    value={compaction}
                    onChange={(e) => onCompactionChange(e.target.value)}
                  />
                }
              />
              <Separator />
              <ConfigRow
                label="Advanced Configurations"
                hint="Extra headers and a first message."
                control={
                  <Switch
                    checked={advanced}
                    onChange={setAdvanced}
                    aria-label="Advanced Configurations"
                  />
                }
              />

              {advanced ? (
                <>
                  {mode === "sandbox" ? (
                    <>
                      <Separator />
                      <ConfigRow
                        label="Container image"
                        hint="Image the sandbox runs; empty uses the configured default."
                        control={
                          <Input
                            inputSize={InputSize.Medium}
                            className="w-[181px]"
                            placeholder="python:3.13-bookworm"
                            value={sandbox.image}
                            onChange={(e) => setSb({ image: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        label="GPUs"
                        hint="Comma-separated GPU list, e.g. all."
                        control={
                          <Input
                            inputSize={InputSize.Medium}
                            className="w-[181px]"
                            placeholder="all"
                            value={sandbox.gpu}
                            onChange={(e) => setSb({ gpu: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        label="Container workdir"
                        hint="Working directory inside the container."
                        control={
                          <Input
                            inputSize={InputSize.Medium}
                            className="w-[181px]"
                            placeholder="/workspace"
                            value={sandbox.workdir}
                            onChange={(e) => setSb({ workdir: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        label="Shared memory size"
                        hint="Container /dev/shm size, e.g. 1g."
                        control={
                          <Input
                            inputSize={InputSize.Medium}
                            className="w-[181px]"
                            placeholder="0"
                            value={sandbox.shm}
                            onChange={(e) => setSb({ shm: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        label="Mounts (HOST:GUEST)"
                        hint="Comma-separated bind mounts."
                        control={
                          <Input
                            inputSize={InputSize.Medium}
                            className="w-[181px]"
                            placeholder="/data:/data"
                            value={sandbox.mounts}
                            onChange={(e) => setSb({ mounts: e.target.value })}
                          />
                        }
                      />
                      <Separator />
                      <ConfigRow
                        label="Don't mount the working directory"
                        secondary
                        control={
                          <Switch
                            checked={sandbox.noMount}
                            onChange={(value) => setSb({ noMount: value })}
                            aria-label="Don't mount the working directory"
                            size={
                              isMobile ? SwitchSize.Large : SwitchSize.Medium
                            }
                          />
                        }
                      />
                    </>
                  ) : null}

                  <Separator />
                  <TextArea
                    label="Extra headers (JSON object)"
                    hintText="Blank keeps the configuration's headers. Enter {} to send none; header values must be strings."
                    placeholder='{"X-Title": "nac"}'
                    value={extraHeaders}
                    onChange={(e) => edit(setExtraHeaders)(e.target.value)}
                    textAreaClassName="h-[108px] resize-none"
                  />
                  <Separator />
                  <TextArea
                    label="Initial prompt"
                    placeholder="Send a first message right after the session is created…"
                    value={initialPrompt}
                    onChange={(e) => edit(setInitialPrompt)(e.target.value)}
                    textAreaClassName="h-[116px] resize-none"
                  />
                </>
              ) : null}
            </div>
          </ConfigurationsPanel>
        ) : null}
      </div>

      <PathPickerModal
        open={picking}
        kind="directory"
        initialPath={cwd.trim()}
        ssh={connected}
        onClose={() => setPicking(false)}
        onSelect={(path) => {
          edit(setCwd)(path);
          setPicking(false);
        }}
      />
    </Modal>
  );
}
