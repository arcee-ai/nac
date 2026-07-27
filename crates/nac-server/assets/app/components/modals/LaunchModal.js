import { React, html } from "../../lib/html.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Input } from "../../atoms/input.js";
import { Select } from "../../atoms/select.js";
import { Button, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { createSession, useStoreInfo } from "../../store/sessionsStore.js";
import { selectSession } from "../../store/selectionStore.js";
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

function Field({ label, children }) {
  return html`<div class="flex flex-col gap-1">
    <label class="label-small text-basic-secondary">${label}</label>
    ${children}
  </div>`;
}

function Check({ label, checked, onChange }) {
  return html`<label class="flex items-center gap-2 cursor-pointer select-none">
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    <span class="label-small text-basic-secondary">${label}</span>
  </label>`;
}

export function LaunchModal({ open, onClose }) {
  const storeInfo = useStoreInfo();
  const toast = useToast();

  const [cwd, setCwd] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [backend, setBackend] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [credentialMode, setCredentialMode] = useState("inherit");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");

  const [sandbox, setSandbox] = useState({
    enabled: false,
    noMount: false,
    image: "",
    gpu: "",
    workdir: "",
    shm: "",
    mounts: "",
  });

  const [initialPrompt, setInitialPrompt] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [configuredBackend, setConfiguredBackend] = useState(null);
  const [configuredBaseUrl, setConfiguredBaseUrl] = useState(null);
  const defaultsGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    setCwd((storeInfo && storeInfo.root_cwd) || "");
    setSshHost("");
    setBackend("");
    setModel("");
    setBaseUrl("");
    setReasoning("");
    setCredentialMode("inherit");
    setApiKeyEnv("");
    setExtraHeaders("");
    setSandbox({ enabled: false, noMount: false, image: "", gpu: "", workdir: "", shm: "", mounts: "" });
    setInitialPrompt("");
    setAdvanced(false);
    setBusy(false);
    setError("");
    setConfiguredBackend(null);
    setConfiguredBaseUrl(null);
  }, [open, storeInfo]);

  // Refresh configured model defaults whenever the location (cwd/ssh) changes.
  useEffect(() => {
    if (!open) return undefined;
    const gen = ++defaultsGen.current;
    const location = launchLocationFromValues({ cwd, ssh_host: sshHost });
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
  }, [open, cwd, sshHost]);

  const isSsh = !!nullable(sshHost);
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
    setBusy(true);
    setError("");
    try {
      const location = launchLocationFromValues({ cwd, ssh_host: sshHost });
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
        setError(validationError.message);
        setBusy(false);
        return;
      }

      const body = { ...location, ...modelPayload };
      if (!location.ssh_host) {
        body.sandbox = {
          enabled: sandbox.enabled,
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
      if (newId) selectSession(newId);
      toast.success("Session created");

      const prompt = initialPrompt.trim();
      if (newId && prompt) {
        try {
          await api.submitRun(newId, { prompt });
        } catch (runError) {
          toast.error(`Session created, but the initial run failed: ${runError.message}`);
        }
      }
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setSb = (patch) => setSandbox((s) => ({ ...s, ...patch }));

  const footer = html`
    <${Button} variant=${ButtonVariant.Tertiary} content=${ButtonContent.Text} onClick=${onClose} disabled=${busy}>
      Cancel
    </${Button}>
    <${Button} variant=${ButtonVariant.Primary} content=${ButtonContent.Text} onClick=${submit} loading=${busy}>
      Create session
    </${Button}>
  `;

  return html`<${Modal} open=${open} onClose=${onClose} title="New session" size=${ModalSize.Medium} footer=${footer}>
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3">
        <${Input}
          label="Working directory (cwd)"
          placeholder=${isSsh ? "~ (remote)" : "/path/to/project"}
          hintText=${isSsh ? "Remote path on the SSH host." : "Defaults to the store root."}
          value=${cwd}
          onInput=${(e) => setCwd(e.target.value)}
        />
        <${Input}
          label="SSH host (optional)"
          placeholder="build-box or user@host"
          hintText="Set to run remotely (disables sandbox)."
          value=${sshHost}
          onInput=${(e) => setSshHost(e.target.value)}
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <${Field} label="Backend">
          <${Select}
            items=${BACKEND_OPTIONS}
            value=${backend}
            onValueChange=${setBackend}
            className="w-full"
            panelClassName="max-h-64 overflow-auto"
          />
        </${Field}>
        <${Input}
          label="Model"
          placeholder="e.g. gpt-5.5 (empty = default)"
          value=${model}
          onInput=${(e) => setModel(e.target.value)}
        />
      </div>

      <button
        type="button"
        class="label-small text-basic-tertiary hover:text-basic-primary text-left w-fit"
        onClick=${() => setAdvanced((v) => !v)}
      >
        ${advanced ? "▾" : "▸"} Advanced options
      </button>

      ${advanced
        ? html`<div class="flex flex-col gap-4 pl-3 border-l border-secondary">
            <div class="grid grid-cols-2 gap-3">
              <${Field} label="Reasoning effort">
                <${Select} items=${REASONING_OPTIONS} value=${reasoning} onValueChange=${setReasoning} className="w-full" panelClassName="max-h-64 overflow-auto" />
              </${Field}>
              <${Input}
                label="Base URL"
                placeholder="https://api.openai.com/v1 (empty = default)"
                value=${displayBaseUrl}
                isDisabled=${baseLocked}
                hintText=${baseLocked ? "Managed by the selected backend." : undefined}
                onInput=${(e) => setBaseUrl(e.target.value)}
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <${Field} label="Credentials">
                <${Select}
                  items=${CREDENTIAL_OPTIONS}
                  value=${effectiveCredMode}
                  onValueChange=${setCredentialMode}
                  disabled=${credLocked}
                  className="w-full"
                />
              </${Field}>
              <${Input}
                label="API key env var"
                placeholder="OPENAI_API_KEY"
                value=${apiKeyEnv}
                isDisabled=${credLocked || effectiveCredMode !== "variable"}
                onInput=${(e) => setApiKeyEnv(e.target.value)}
              />
            </div>

            <${Input}
              label="Extra headers (JSON)"
              placeholder=${'{"X-Title": "nac"}'}
              value=${extraHeaders}
              onInput=${(e) => setExtraHeaders(e.target.value)}
            />

            ${!isSsh
              ? html`<div class="flex flex-col gap-3 rounded-lg border border-secondary p-3">
                  <div class="tag-label text-basic-muted">Sandbox</div>
                  <div class="flex gap-4">
                    <${Check} label="Enabled" checked=${sandbox.enabled} onChange=${(v) => setSb({ enabled: v })} />
                    <${Check} label="Don't mount cwd" checked=${sandbox.noMount} onChange=${(v) => setSb({ noMount: v })} />
                  </div>
                  ${sandbox.enabled
                    ? html`<div class="flex flex-col gap-3">
                        <div class="grid grid-cols-2 gap-3">
                          <${Input} label="Image" placeholder="python:3.13-bookworm" value=${sandbox.image} onInput=${(e) => setSb({ image: e.target.value })} />
                          <${Input} label="GPUs (csv)" placeholder="all" value=${sandbox.gpu} onInput=${(e) => setSb({ gpu: e.target.value })} />
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                          <${Input} label="Workdir" placeholder="/workspace" value=${sandbox.workdir} onInput=${(e) => setSb({ workdir: e.target.value })} />
                          <${Input} label="Shm size" placeholder="0" value=${sandbox.shm} onInput=${(e) => setSb({ shm: e.target.value })} />
                        </div>
                        <${Input} label="Mounts (HOST:GUEST, csv)" placeholder="/data:/data" value=${sandbox.mounts} onInput=${(e) => setSb({ mounts: e.target.value })} />
                      </div>`
                    : null}
                </div>`
              : null}
          </div>`
        : null}

      <${Field} label="Initial prompt (optional)">
        <textarea
          class="input rounded-[8px] px-3 py-2 resize-none min-h-[72px] font-normal leading-relaxed"
          placeholder="Send a first message right after the session is created…"
          value=${initialPrompt}
          onInput=${(e) => setInitialPrompt(e.target.value)}
        ></textarea>
      </${Field}>

      ${error ? html`<p class="text-error-primary text-micro">${error}</p>` : null}
    </div>
  </${Modal}>`;
}
