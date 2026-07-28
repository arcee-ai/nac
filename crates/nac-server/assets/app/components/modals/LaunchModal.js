import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Icon } from "../../atoms/icon.js";
import { Input, InputSize, InputTrailing } from "../../atoms/input.js";
import { Select } from "../../atoms/select.js";
import { Switch } from "../../atoms/switch.js";
import { Tooltip } from "../../atoms/tooltip.js";
import { Button, ButtonVariant, ButtonContent, ButtonSize } from "../../atoms/button.js";
import { createSession, renameSession, useStoreInfo } from "../../store/sessionsStore.js";
import { openSession } from "../../store/routeStore.js";
import { api } from "../../services/api.js";
import { useToast } from "../../providers/ToastProvider.js";
import { BACKEND_OPTIONS, REASONING_OPTIONS, CREDENTIAL_OPTIONS } from "./options.js";
import {
  buildLaunchModelPayload,
  launchLocationFromValues,
  effectiveBackend,
  managedLaunchBaseUrl,
  nullable,
  csv,
} from "../../lib/modelConfig.js";

const { useState, useEffect, useRef } = React;

const MODE_LOCAL = "local";
const MODE_SSH = "ssh";
const MODE_SANDBOX = "sandbox";
const MODES = [
  { id: MODE_LOCAL, label: "Local" },
  { id: MODE_SSH, label: "SSH" },
  { id: MODE_SANDBOX, label: "Sandbox" },
];

// "config.toml" is how the design spells "inherited from configuration".
const INHERIT_LABEL = "config.toml";
const withInheritLabel = (items) =>
  items.map((item) => (item.id === "" || item.id === "inherit" ? { ...item, label: INHERIT_LABEL } : item));
const CONFIG_BACKENDS = withInheritLabel(BACKEND_OPTIONS);
const CONFIG_REASONING = withInheritLabel(REASONING_OPTIONS);
// Shortened next to the row label, which already says what the value is about.
const CONFIG_CREDENTIALS = CREDENTIAL_OPTIONS.map((item) =>
  item.id === "inherit" ? { ...item, label: INHERIT_LABEL } : item.id === "none" ? { ...item, label: "None" } : item,
);

function InfoHint({ text }) {
  return html`<${Tooltip} title=${text} position="bottom-left">
    <${Icon} name="info" size=${16} className="text-basic-muted shrink-0" />
  </${Tooltip}>`;
}

function FieldLabel({ label, hint, required, invalid }) {
  return html`<div class="flex items-center gap-1 w-full">
    <div class=${cn("label-small", invalid ? "text-error-primary" : "text-basic-primary")}>${label}</div>
    ${hint ? html`<${InfoHint} text=${hint} />` : null}
    ${required
      ? html`<div class="flex-1 text-right text-micro text-basic-muted">Required</div>`
      : null}
  </div>`;
}

// One line inside the Configurations box: label on the left, control on the right.
function ConfigRow({ label, hint, invalid, control, secondary }) {
  return html`<div class="flex items-center gap-1 w-full min-h-5">
    <div class="flex items-center gap-1 flex-1 min-w-0">
      <div
        class=${cn(
          "truncate",
          secondary ? "text-micro" : "label-micro",
          invalid ? "text-error-primary" : secondary ? "text-basic-secondary" : "text-basic-primary",
        )}
      >
        ${label}
      </div>
      ${hint ? html`<${InfoHint} text=${hint} />` : null}
    </div>
    <div class="shrink-0">${control}</div>
  </div>`;
}

function ConfigDivider() {
  return html`<div class="h-px w-full bg-divider-muted"></div>`;
}

// Full-width block inside the same box as the single-line rows: label above the
// control, optional helper line underneath.
function ConfigTextArea({ label, help, placeholder, value, onInput, className }) {
  return html`<div class="flex flex-col gap-1 w-full">
    <div class="label-micro text-basic-primary">${label}</div>
    <textarea
      class=${cn("input rounded-[4px] px-3 py-2 resize-none font-normal leading-relaxed", className)}
      placeholder=${placeholder}
      value=${value}
      onInput=${onInput}
    ></textarea>
    ${help ? html`<div class="text-micro text-basic-muted">${help}</div>` : null}
  </div>`;
}

export function LaunchModal({ open, onClose }) {
  const storeInfo = useStoreInfo();
  const toast = useToast();

  const [mode, setMode] = useState(MODE_LOCAL);
  const [cwd, setCwd] = useState("");
  const [title, setTitle] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [backend, setBackend] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credentialMode, setCredentialMode] = useState("inherit");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [compaction, setCompaction] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [sandbox, setSandbox] = useState({
    noMount: false,
    image: "",
    gpu: "",
    workdir: "",
    shm: "",
    mounts: "",
  });

  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  // { field, message } — `field` marks which control to flag; "config" flags the box.
  const [error, setError] = useState(null);

  const [configuredBackend, setConfiguredBackend] = useState(null);
  const [configuredBaseUrl, setConfiguredBaseUrl] = useState(null);
  const defaultsGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMode(MODE_LOCAL);
    setCwd((storeInfo && storeInfo.root_cwd) || "");
    setTitle("");
    setSshHost("");
    setBackend("");
    setModel("");
    setBaseUrl("");
    setCredentialMode("inherit");
    setApiKeyEnv("");
    setReasoning("");
    setCompaction("");
    setExtraHeaders("");
    setInitialPrompt("");
    setSandbox({ noMount: false, image: "", gpu: "", workdir: "", shm: "", mounts: "" });
    setAdvanced(false);
    setBusy(false);
    setError(null);
    setConfiguredBackend(null);
    setConfiguredBaseUrl(null);
  }, [open, storeInfo]);

  // Refresh configured model defaults whenever the location (cwd/ssh) changes.
  useEffect(() => {
    if (!open) return undefined;
    const gen = ++defaultsGen.current;
    const location = launchLocationFromValues({ cwd, ssh_host: mode === MODE_SSH ? sshHost : "" });
    const t = setTimeout(async () => {
      try {
        const defaults = await api.launchDefaults(location);
        if (gen !== defaultsGen.current) return;
        setConfiguredBackend(defaults?.configured_model_backend || null);
        setConfiguredBaseUrl(defaults?.configured_model_base_url || null);
      } catch (_) {
        /* non-fatal: defaults just stay unknown */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, cwd, sshHost, mode]);

  // Any edit clears the previous attempt's error, which also re-enables submit.
  const edit = (setter) => (value) => {
    setError(null);
    setter(value);
  };
  const setSb = (patch) => {
    setError(null);
    setSandbox((s) => ({ ...s, ...patch }));
  };

  const isSsh = mode === MODE_SSH;
  const explicitBackend = backend.trim();
  const effBackend = effectiveBackend(backend, configuredBackend);
  const managedUrl = managedLaunchBaseUrl(effBackend);
  const baseLocked = !!managedUrl;
  const credLocked = !!managedUrl;
  const displayBaseUrl = managedUrl
    ? !explicitBackend
      ? configuredBaseUrl || managedUrl
      : managedUrl
    : baseUrl;
  const effectiveCredMode = credLocked ? "none" : credentialMode;

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

    let modelPayload;
    try {
      modelPayload = buildLaunchModelPayload({
        model,
        base_url: baseUrl,
        backend,
        reasoning_effort: reasoning,
        credential_mode: credentialMode,
        api_key_env: apiKeyEnv,
        extra_headers: extraHeaders,
        configured_backend: configuredBackend,
      });
    } catch (validationError) {
      setError({ field: "config", message: `Invalid configurations: ${validationError.message}` });
      return;
    }

    setBusy(true);
    try {
      const location = launchLocationFromValues({ cwd, ssh_host: isSsh ? sshHost : "" });
      const body = { ...location, ...modelPayload };
      const threshold = nullable(compaction);
      if (threshold !== null) body.orchestrator_compaction_threshold = Number(threshold);
      if (!location.ssh_host) {
        body.sandbox = {
          enabled: mode === MODE_SANDBOX,
          no_mount_cwd: sandbox.noMount,
          image: nullable(sandbox.image),
          gpus: csv(sandbox.gpu),
          workdir: nullable(sandbox.workdir),
          shm_size: nullable(sandbox.shm),
          mounts: csv(sandbox.mounts),
          mounts_ro: [],
        };
      }

      const snap = await createSession(body);
      const newId = snap && ((snap.metadata && snap.metadata.session_id) || snap.session_id);
      toast.success("Session created");

      // Titles are presentation state, so they are applied after creation.
      const wantedTitle = nullable(title);
      if (newId && wantedTitle) {
        try {
          await renameSession(newId, { title: wantedTitle, pinned: false, expected_version: 0 });
        } catch (renameError) {
          toast.error(`Session created, but the title was not saved: ${renameError.message}`);
        }
      }

      const prompt = initialPrompt.trim();
      if (newId && prompt) {
        try {
          await api.submitRun(newId, { prompt });
        } catch (runError) {
          toast.error(`Session created, but the initial run failed: ${runError.message}`);
        }
      }
      if (newId) openSession(newId);
      onClose();
    } catch (e) {
      setError({ field: "config", message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const invalid = (field) => !!error && error.field === field;

  const footer = html`<${Button}
    variant=${ButtonVariant.Primary}
    size=${ButtonSize.Large}
    content=${ButtonContent.Text}
    onClick=${submit}
    loading=${busy}
    disabled=${!!error}
  >
    Create Session
  </${Button}>`;

  const smallSelect = (items, value, onValueChange, disabled) => html`<${Select}
    items=${items}
    value=${value}
    onValueChange=${onValueChange}
    disabled=${disabled}
    size=${ButtonSize.Small}
    variant=${ButtonVariant.Ghost}
    panelClassName="right-0 max-h-64 overflow-auto"
  />`;

  const smallInput = (props) => html`<${Input}
    inputSize=${InputSize.Small}
    className="w-[181px]"
    ...${props}
  />`;

  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title="New Session"
    size=${ModalSize.Wide}
    flush=${true}
    footer=${footer}
    className="h-[680px]"
  >
    <div class="flex flex-col gap-6 [&>*]:shrink-0">
      <div class="flex flex-col gap-1">
        <${FieldLabel} label="Execution" hint="Where the agent runs: on this machine, over SSH, or inside a container." />
        <div class="flex items-start gap-3">
          ${MODES.map(
            (m) => html`<${Button}
              key=${m.id}
              variant=${mode === m.id ? ButtonVariant.Primary : ButtonVariant.Secondary}
              size=${ButtonSize.Medium}
              content=${ButtonContent.Text}
              onClick=${() => edit(setMode)(m.id)}
              aria-pressed=${mode === m.id ? "true" : "false"}
            >
              ${m.label}
            </${Button}>`,
          )}
        </div>
      </div>

      ${isSsh
        ? html`<div class="flex flex-col gap-1">
            <${FieldLabel}
              label="SSH Host"
              hint="OpenSSH target, e.g. build-box or user@host."
              required=${true}
              invalid=${invalid("sshHost")}
            />
            <${Input}
              inputSize=${InputSize.Medium}
              placeholder="build-box or user@host"
              value=${sshHost}
              validation=${invalid("sshHost")}
              validationText=${invalid("sshHost") ? error.message : ""}
              onInput=${(e) => edit(setSshHost)(e.target.value)}
            />
          </div>`
        : null}

      <div class="flex items-start gap-4">
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <${FieldLabel}
            label="Working Directory"
            hint=${isSsh ? "Path on the SSH host; defaults to the remote home." : "Project directory the agent works in."}
            required=${!isSsh}
            invalid=${invalid("cwd")}
          />
          <${Input}
            inputSize=${InputSize.Medium}
            trailing=${InputTrailing.Icon}
            trailingIconName="folder"
            placeholder=${isSsh ? "~ (remote)" : "/path/to/project"}
            value=${cwd}
            validation=${invalid("cwd")}
            validationText=${invalid("cwd") ? error.message : ""}
            onInput=${(e) => edit(setCwd)(e.target.value)}
          />
        </div>
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <${FieldLabel} label="Title (optional)" />
          <${Input}
            inputSize=${InputSize.Medium}
            placeholder="Shown on the session card"
            value=${title}
            onInput=${(e) => edit(setTitle)(e.target.value)}
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-4 w-full">
          <div
            class=${cn(
              "label-small flex-1 min-w-0",
              invalid("config") ? "text-error-primary" : "text-basic-primary",
            )}
          >
            Configurations
          </div>
          <div class="text-micro text-basic-muted shrink-0">Required</div>
        </div>
        <div
          class=${cn(
            "flex flex-col rounded-[4px] bg-input shadow-concave p-3 gap-2",
            invalid("config") && "border-2 border-error-primary",
          )}
        >
          <${ConfigRow}
            label="Backend"
            hint="Provider protocol; inherit to use the value from config.toml."
            control=${smallSelect(CONFIG_BACKENDS, backend, edit(setBackend), false)}
          />
          <${ConfigDivider} />
          <${ConfigRow}
            label="Model"
            hint="Model identifier, e.g. gpt-5.5. Leave empty to inherit."
            control=${smallInput({
              placeholder: INHERIT_LABEL,
              value: model,
              onInput: (e) => edit(setModel)(e.target.value),
            })}
          />
          <${ConfigDivider} />
          <${ConfigRow}
            label="Base URL"
            hint=${baseLocked
              ? "Managed by the selected backend."
              : "API endpoint. Leave empty to inherit."}
            control=${smallInput({
              placeholder: INHERIT_LABEL,
              value: displayBaseUrl,
              isDisabled: baseLocked,
              onInput: (e) => edit(setBaseUrl)(e.target.value),
            })}
          />
          <${ConfigDivider} />
          <${ConfigRow}
            label="API Key"
            hint="How the API key is provided to the session."
            control=${smallSelect(CONFIG_CREDENTIALS, effectiveCredMode, edit(setCredentialMode), credLocked)}
          />
          <${ConfigRow}
            label="API key environment variable"
            hint="Name of the environment variable holding the key."
            secondary=${true}
            control=${smallInput({
              placeholder: "eg. OPENAI_API_KEY",
              value: apiKeyEnv,
              isDisabled: credLocked || effectiveCredMode !== "variable",
              onInput: (e) => edit(setApiKeyEnv)(e.target.value),
            })}
          />
        </div>
        ${error && error.field === "config"
          ? html`<p class="label-micro text-error-primary">${error.message}</p>`
          : null}
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-4 w-full">
          <div class="label-small text-basic-primary flex-1 min-w-0">Advanced Configurations</div>
          <${Switch} checked=${advanced} onChange=${setAdvanced} aria-label="Advanced Configurations" />
        </div>
        ${advanced
          ? html`<div class="flex flex-col rounded-[4px] bg-input shadow-concave p-3 gap-2">
              <${ConfigRow}
                label="Reasoning"
                hint="Reasoning effort passed to the model."
                control=${smallSelect(CONFIG_REASONING, reasoning, edit(setReasoning), false)}
              />
              <${ConfigDivider} />
              <${ConfigRow}
                label="Orchestrator compaction threshold"
                hint="Context size that triggers compaction; 0 disables it."
                control=${smallInput({
                  placeholder: INHERIT_LABEL,
                  value: compaction,
                  inputMode: "numeric",
                  onInput: (e) => edit(setCompaction)(e.target.value),
                })}
              />
              ${mode === MODE_SANDBOX
                ? html`<${ConfigDivider} />
                    <${ConfigRow}
                      label="Container image"
                      hint="Image the sandbox runs; empty uses the configured default."
                      control=${smallInput({
                        placeholder: "python:3.13-bookworm",
                        value: sandbox.image,
                        onInput: (e) => setSb({ image: e.target.value }),
                      })}
                    />
                    <${ConfigDivider} />
                    <${ConfigRow}
                      label="GPUs"
                      hint="Comma-separated GPU list, e.g. all."
                      control=${smallInput({
                        placeholder: "all",
                        value: sandbox.gpu,
                        onInput: (e) => setSb({ gpu: e.target.value }),
                      })}
                    />
                    <${ConfigDivider} />
                    <${ConfigRow}
                      label="Container workdir"
                      hint="Working directory inside the container."
                      control=${smallInput({
                        placeholder: "/workspace",
                        value: sandbox.workdir,
                        onInput: (e) => setSb({ workdir: e.target.value }),
                      })}
                    />
                    <${ConfigDivider} />
                    <${ConfigRow}
                      label="Shared memory size"
                      hint="Container /dev/shm size, e.g. 1g."
                      control=${smallInput({
                        placeholder: "0",
                        value: sandbox.shm,
                        onInput: (e) => setSb({ shm: e.target.value }),
                      })}
                    />
                    <${ConfigDivider} />
                    <${ConfigRow}
                      label="Mounts (HOST:GUEST)"
                      hint="Comma-separated bind mounts."
                      control=${smallInput({
                        placeholder: "/data:/data",
                        value: sandbox.mounts,
                        onInput: (e) => setSb({ mounts: e.target.value }),
                      })}
                    />
                    <${ConfigDivider} />
                    <${ConfigRow}
                      label="Don't mount the working directory"
                      secondary=${true}
                      control=${html`<${Switch}
                        checked=${sandbox.noMount}
                        onChange=${(v) => setSb({ noMount: v })}
                        aria-label="Don't mount the working directory"
                      />`}
                    />`
                : null}
              <${ConfigDivider} />
              <${ConfigTextArea}
                label="Extra headers (JSON object)"
                help=${"Blank inherits configured headers. Enter {} to explicitly clear them for the new session; header values must be strings."}
                placeholder=${'{"X-Title": "nac"}'}
                value=${extraHeaders}
                onInput=${(e) => edit(setExtraHeaders)(e.target.value)}
                className="h-[108px]"
              />
              <${ConfigDivider} />
              <${ConfigTextArea}
                label="Initial prompt"
                placeholder="Send a first message right after the session is created…"
                value=${initialPrompt}
                onInput=${(e) => edit(setInitialPrompt)(e.target.value)}
                className="h-[116px]"
              />
            </div>`
          : null}
      </div>
    </div>
  </${Modal}>`;
}
