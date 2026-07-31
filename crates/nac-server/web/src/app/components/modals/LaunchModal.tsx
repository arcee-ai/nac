import { useState } from "react";
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
  InputTrailing,
  Modal,
  ModalSize,
  Select,
  type SelectItem,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import {
  BACKEND_OPTIONS,
  CREDENTIAL_OPTIONS,
  REASONING_OPTIONS,
} from "@/app/components/modals/options";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import { cn } from "@/app/lib/cn";
import {
  buildLaunchModelPayload,
  csv,
  effectiveBackend,
  launchLocationFromValues,
  managedLaunchBaseUrl,
  nullable,
  type CredentialMode,
} from "@/app/lib/modelConfig";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import {
  useCreateSession,
  useLaunchDefaults,
  useStoreInfo,
  useUpdatePresentation,
} from "@/app/services/queries";
import type { CreateSessionRequest } from "@/app/types/api";

type Mode = "local" | "ssh" | "sandbox";

const MODES: { id: Mode; label: string }[] = [
  { id: "local", label: "Local" },
  { id: "ssh", label: "SSH" },
  { id: "sandbox", label: "Sandbox" },
];

// "config.toml" is how the design spells "inherited from configuration".
const INHERIT_LABEL = "config.toml";

const withInheritLabel = (items: SelectItem[]) =>
  items.map((item) =>
    item.id === "" || item.id === "inherit" ? { ...item, label: INHERIT_LABEL } : item,
  );

const CONFIG_BACKENDS = withInheritLabel(BACKEND_OPTIONS);
const CONFIG_REASONING = withInheritLabel(REASONING_OPTIONS);
// Shortened next to the row label, which already says what the value is about.
const CONFIG_CREDENTIALS = CREDENTIAL_OPTIONS.map((item) =>
  item.id === "inherit"
    ? { ...item, label: INHERIT_LABEL }
    : item.id === "none"
      ? { ...item, label: "None" }
      : item,
);

const DEFAULTS_DEBOUNCE_MS = 250;

function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip title={text} position={TooltipPosition.BottomLeft}>
      <Icon iconName={IconName.Info} className="text-basic-muted shrink-0" />
    </Tooltip>
  );
}

function FieldLabel({
  label,
  hint,
  required = false,
  invalid = false,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 w-full">
      <div className={cn("label-small", invalid ? "text-error-primary" : "text-basic-primary")}>
        {label}
      </div>
      {hint ? <InfoHint text={hint} /> : null}
      {required ? (
        <div className="flex-1 text-right text-micro text-basic-muted">Required</div>
      ) : null}
    </div>
  );
}

/** One line inside the Configurations box: label left, control right. */
function ConfigRow({
  label,
  hint,
  invalid = false,
  secondary = false,
  control,
}: {
  label: string;
  hint?: string;
  invalid?: boolean;
  secondary?: boolean;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 w-full min-h-5">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <div
          className={cn(
            "truncate",
            secondary ? "text-micro" : "label-micro",
            invalid
              ? "text-error-primary"
              : secondary
                ? "text-basic-secondary"
                : "text-basic-primary",
          )}
        >
          {label}
        </div>
        {hint ? <InfoHint text={hint} /> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ConfigDivider() {
  return <div className="h-px w-full bg-divider-muted" />;
}

function ConfigTextArea({
  label,
  help,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string;
  help?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="label-micro text-basic-primary">{label}</div>
      <textarea
        className={cn(
          "input rounded-[4px] px-3 py-2 resize-none font-normal leading-relaxed",
          className,
        )}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {help ? <div className="text-micro text-basic-muted">{help}</div> : null}
    </div>
  );
}

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
  field: "cwd" | "sshHost" | "config";
  message: string;
}

/** Remounted on every open so the form always starts from the configured defaults. */
export function LaunchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: storeInfo } = useStoreInfo();
  if (!open) return null;
  return <LaunchForm defaultCwd={storeInfo?.root_cwd ?? ""} onClose={onClose} />;
}

function LaunchForm({
  defaultCwd,
  onClose,
}: {
  defaultCwd: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const createSession = useCreateSession();
  const updatePresentation = useUpdatePresentation();

  const [mode, setMode] = useState<Mode>("local");
  const [cwd, setCwd] = useState(defaultCwd);
  const [title, setTitle] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [backend, setBackend] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("inherit");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [compaction, setCompaction] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [sandbox, setSandbox] = useState<SandboxState>(EMPTY_SANDBOX);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  const isSsh = mode === "ssh";
  const busy = createSession.isPending;

  // Configured defaults follow the location, so they are refreshed as the user
  // types a path or a host.
  const debouncedCwd = useDebouncedValue(cwd, DEFAULTS_DEBOUNCE_MS);
  const debouncedHost = useDebouncedValue(isSsh ? sshHost : "", DEFAULTS_DEBOUNCE_MS);
  const { data: defaults } = useLaunchDefaults(
    launchLocationFromValues({ cwd: debouncedCwd, ssh_host: debouncedHost }),
  );
  const configuredBackend = defaults?.configured_model_backend ?? null;
  const configuredBaseUrl = defaults?.configured_model_base_url ?? null;

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

  const explicitBackend = backend.trim();
  const managedUrl = managedLaunchBaseUrl(effectiveBackend(backend, configuredBackend));
  const locked = Boolean(managedUrl);
  const displayBaseUrl = managedUrl
    ? explicitBackend
      ? managedUrl
      : (configuredBaseUrl ?? managedUrl)
    : baseUrl;
  const effectiveCredMode: CredentialMode = locked ? "none" : credentialMode;

  const submit = async () => {
    if (busy) return;
    if (isSsh && !nullable(sshHost)) {
      setError({ field: "sshHost", message: "An SSH host is required for a remote session." });
      return;
    }
    if (!isSsh && !nullable(cwd)) {
      setError({ field: "cwd", message: "A working directory is required." });
      return;
    }

    let body: CreateSessionRequest;
    try {
      body = {
        ...launchLocationFromValues({ cwd, ssh_host: isSsh ? sshHost : "" }),
        ...buildLaunchModelPayload({
          model,
          base_url: baseUrl,
          backend,
          reasoning_effort: reasoning,
          credential_mode: credentialMode,
          api_key_env: apiKeyEnv,
          extra_headers: extraHeaders,
          configured_backend: configuredBackend,
        }),
      };
    } catch (validationError) {
      setError({
        field: "config",
        message: `Invalid configurations: ${errorMessage(validationError)}`,
      });
      return;
    }

    const threshold = nullable(compaction);
    if (threshold !== null) body.orchestrator_compaction_threshold = Number(threshold);
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
            `Session created, but the initial run failed: ${errorMessage(runError)}`,
          );
        }
      }

      if (newId) navigate(routes.session(newId));
      onClose();
    } catch (createError) {
      setError({ field: "config", message: errorMessage(createError) });
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
      size={ButtonSize.Small}
      variant={ButtonVariant.Ghost}
      panelClassName="right-0 max-h-64 overflow-auto"
    />
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="New Session"
      size={ModalSize.Wide}
      flush
      className="h-[680px]"
      footer={
        <Button
          variant={ButtonVariant.Primary}
          size={ButtonSize.Large}
          content={ButtonContent.Text}
          onClick={submit}
          loading={busy}
          disabled={Boolean(error)}
        >
          Create Session
        </Button>
      }
    >
      <div className="flex flex-col gap-6 [&>*]:shrink-0">
        <div className="flex flex-col gap-1">
          <FieldLabel
            label="Execution"
            hint="Where the agent runs: on this machine, over SSH, or inside a container."
          />
          <div className="flex items-start gap-3">
            {MODES.map((item) => (
              <Button
                key={item.id}
                variant={mode === item.id ? ButtonVariant.Primary : ButtonVariant.Secondary}
                size={ButtonSize.Medium}
                content={ButtonContent.Text}
                onClick={() => edit(setMode)(item.id)}
                aria-pressed={mode === item.id}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        {isSsh ? (
          <div className="flex flex-col gap-1">
            <FieldLabel
              label="SSH Host"
              hint="OpenSSH target, e.g. build-box or user@host."
              required
              invalid={invalid("sshHost")}
            />
            <Input
              inputSize={InputSize.Medium}
              placeholder="build-box or user@host"
              value={sshHost}
              validation={invalid("sshHost")}
              validationText={invalid("sshHost") ? error?.message : ""}
              onChange={(e) => edit(setSshHost)(e.target.value)}
            />
          </div>
        ) : null}

        <div className="flex items-start gap-4">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <FieldLabel
              label="Working Directory"
              hint={
                isSsh
                  ? "Path on the SSH host; defaults to the remote home."
                  : "Project directory the agent works in."
              }
              required={!isSsh}
              invalid={invalid("cwd")}
            />
            <Input
              inputSize={InputSize.Medium}
              trailing={InputTrailing.Icon}
              trailingIconName={IconName.Folder}
              placeholder={isSsh ? "~ (remote)" : "/path/to/project"}
              value={cwd}
              validation={invalid("cwd")}
              validationText={invalid("cwd") ? error?.message : ""}
              onChange={(e) => edit(setCwd)(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <FieldLabel label="Title (optional)" />
            <Input
              inputSize={InputSize.Medium}
              placeholder="Shown on the session card"
              value={title}
              onChange={(e) => edit(setTitle)(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-4 w-full">
            <div
              className={cn(
                "label-small flex-1 min-w-0",
                invalid("config") ? "text-error-primary" : "text-basic-primary",
              )}
            >
              Configurations
            </div>
            <div className="text-micro text-basic-muted shrink-0">Required</div>
          </div>
          <div
            className={cn(
              "flex flex-col rounded-[4px] bg-input shadow-concave p-3 gap-2",
              invalid("config") && "border-2 border-error-primary",
            )}
          >
            <ConfigRow
              label="Backend"
              hint="Provider protocol; inherit to use the value from config.toml."
              control={smallSelect(CONFIG_BACKENDS, backend, edit(setBackend))}
            />
            <ConfigDivider />
            <ConfigRow
              label="Model"
              hint="Model identifier, e.g. gpt-5.5. Leave empty to inherit."
              control={
                <Input
                  inputSize={InputSize.Small}
                  className="w-[181px]"
                  placeholder={INHERIT_LABEL}
                  value={model}
                  onChange={(e) => edit(setModel)(e.target.value)}
                />
              }
            />
            <ConfigDivider />
            <ConfigRow
              label="Base URL"
              hint={
                locked
                  ? "Managed by the selected backend."
                  : "API endpoint. Leave empty to inherit."
              }
              control={
                <Input
                  inputSize={InputSize.Small}
                  className="w-[181px]"
                  placeholder={INHERIT_LABEL}
                  value={displayBaseUrl}
                  isDisabled={locked}
                  onChange={(e) => edit(setBaseUrl)(e.target.value)}
                />
              }
            />
            <ConfigDivider />
            <ConfigRow
              label="API Key"
              hint="How the API key is provided to the session."
              control={smallSelect(
                CONFIG_CREDENTIALS,
                effectiveCredMode,
                (id) => edit(setCredentialMode)(id as CredentialMode),
                locked,
              )}
            />
            <ConfigRow
              label="API key environment variable"
              hint="Name of the environment variable holding the key."
              secondary
              control={
                <Input
                  inputSize={InputSize.Small}
                  className="w-[181px]"
                  placeholder="eg. OPENAI_API_KEY"
                  value={apiKeyEnv}
                  isDisabled={locked || effectiveCredMode !== "variable"}
                  onChange={(e) => edit(setApiKeyEnv)(e.target.value)}
                />
              }
            />
          </div>
          {invalid("config") ? (
            <p className="label-micro text-error-primary">{error?.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 w-full">
            <div className="label-small text-basic-primary flex-1 min-w-0">
              Advanced Configurations
            </div>
            <Switch
              checked={advanced}
              onChange={setAdvanced}
              aria-label="Advanced Configurations"
            />
          </div>

          {advanced ? (
            <div className="flex flex-col rounded-[4px] bg-input shadow-concave p-3 gap-2">
              <ConfigRow
                label="Reasoning"
                hint="Reasoning effort passed to the model."
                control={smallSelect(CONFIG_REASONING, reasoning, edit(setReasoning))}
              />
              <ConfigDivider />
              <ConfigRow
                label="Orchestrator compaction threshold"
                hint="Context size that triggers compaction; 0 disables it."
                control={
                  <Input
                    inputSize={InputSize.Small}
                    className="w-[181px]"
                    placeholder={INHERIT_LABEL}
                    inputMode="numeric"
                    value={compaction}
                    onChange={(e) => edit(setCompaction)(e.target.value)}
                  />
                }
              />

              {mode === "sandbox" ? (
                <>
                  <ConfigDivider />
                  <ConfigRow
                    label="Container image"
                    hint="Image the sandbox runs; empty uses the configured default."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className="w-[181px]"
                        placeholder="python:3.13-bookworm"
                        value={sandbox.image}
                        onChange={(e) => setSb({ image: e.target.value })}
                      />
                    }
                  />
                  <ConfigDivider />
                  <ConfigRow
                    label="GPUs"
                    hint="Comma-separated GPU list, e.g. all."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className="w-[181px]"
                        placeholder="all"
                        value={sandbox.gpu}
                        onChange={(e) => setSb({ gpu: e.target.value })}
                      />
                    }
                  />
                  <ConfigDivider />
                  <ConfigRow
                    label="Container workdir"
                    hint="Working directory inside the container."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className="w-[181px]"
                        placeholder="/workspace"
                        value={sandbox.workdir}
                        onChange={(e) => setSb({ workdir: e.target.value })}
                      />
                    }
                  />
                  <ConfigDivider />
                  <ConfigRow
                    label="Shared memory size"
                    hint="Container /dev/shm size, e.g. 1g."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className="w-[181px]"
                        placeholder="0"
                        value={sandbox.shm}
                        onChange={(e) => setSb({ shm: e.target.value })}
                      />
                    }
                  />
                  <ConfigDivider />
                  <ConfigRow
                    label="Mounts (HOST:GUEST)"
                    hint="Comma-separated bind mounts."
                    control={
                      <Input
                        inputSize={InputSize.Small}
                        className="w-[181px]"
                        placeholder="/data:/data"
                        value={sandbox.mounts}
                        onChange={(e) => setSb({ mounts: e.target.value })}
                      />
                    }
                  />
                  <ConfigDivider />
                  <ConfigRow
                    label="Don't mount the working directory"
                    secondary
                    control={
                      <Switch
                        checked={sandbox.noMount}
                        onChange={(value) => setSb({ noMount: value })}
                        aria-label="Don't mount the working directory"
                      />
                    }
                  />
                </>
              ) : null}

              <ConfigDivider />
              <ConfigTextArea
                label="Extra headers (JSON object)"
                help="Blank inherits configured headers. Enter {} to explicitly clear them for the new session; header values must be strings."
                placeholder='{"X-Title": "nac"}'
                value={extraHeaders}
                onChange={edit(setExtraHeaders)}
                className="h-[108px]"
              />
              <ConfigDivider />
              <ConfigTextArea
                label="Initial prompt"
                placeholder="Send a first message right after the session is created…"
                value={initialPrompt}
                onChange={edit(setInitialPrompt)}
                className="h-[116px]"
              />
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
