import { React, html } from "../../lib/html.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Input } from "../../atoms/input.js";
import { Select } from "../../atoms/select.js";
import { Button, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { updateConfig, useSnapshot } from "../../store/sessionsStore.js";
import { api } from "../../services/api.js";
import { useToast } from "../../providers/ToastProvider.js";
import { BACKEND_OPTIONS, REASONING_OPTIONS, CREDENTIAL_OPTIONS } from "./options.js";
import { buildSettingsPatch, managedLaunchBaseUrl } from "../../lib/modelConfig.js";

const { useState, useEffect, useRef } = React;

// Settings requires explicit credentials (no "inherit").
const SETTINGS_CREDENTIAL_OPTIONS = CREDENTIAL_OPTIONS.filter((o) => o.id !== "inherit");

function Field({ label, children }) {
  return html`<div class="flex flex-col gap-1">
    <label class="label-small text-basic-secondary">${label}</label>
    ${children}
  </div>`;
}

function headersToText(h) {
  if (!h || typeof h !== "object" || Object.keys(h).length === 0) return "";
  return JSON.stringify(h, null, 2);
}

function parseHeadersJson(json) {
  if (!json) return {};
  try {
    const p = JSON.parse(json);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch (_) {
    return {};
  }
}

export function SettingsModal({ open, onClose, id }) {
  const snap = useSnapshot(id);
  const toast = useToast();
  const initial = useRef({});
  const [model, setModel] = useState("");
  const [backend, setBackend] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [credentialMode, setCredentialMode] = useState("none");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [diagnostics, setDiagnostics] = useState([]);

  // Fetch the persisted config for diagnostics ("repair required") and as a
  // fallback source when the live snapshot metadata is unavailable.
  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.get(`/sessions/${encodeURIComponent(id)}/config`);
        if (cancelled) return;
        setDiagnostics(cfg.diagnostics || []);
        if (!snap || !snap.metadata) {
          applyInitial({
            model: cfg.model || "",
            backend: cfg.backend || "",
            reasoning_effort: cfg.reasoning_effort || "",
            api_key_env: cfg.api_key_env || "",
            base_url: cfg.base_url || "",
            extra_headers: parseHeadersJson(cfg.extra_headers_json),
          });
        }
      } catch (_) {
        /* diagnostics are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [open, id]);

  useEffect(() => {
    if (!open || !snap || !snap.metadata) return;
    const meta = snap.metadata;
    applyInitial({
      model: meta.model || "",
      backend: meta.backend || "",
      reasoning_effort: meta.reasoning_effort || "",
      api_key_env: meta.api_key_env || "",
      base_url: meta.base_url || "",
      extra_headers: meta.extra_headers || {},
    });
    // eslint-disable-next-line
  }, [open, id, snap && snap.metadata && snap.metadata.session_id]);

  function applyInitial(meta) {
    const mode = meta.api_key_env ? "variable" : "none";
    initial.current = {
      model: meta.model,
      backend: meta.backend,
      base_url: meta.base_url,
      reasoning_effort: meta.reasoning_effort || null,
      api_key_env: meta.api_key_env || null,
      extra_headers: meta.extra_headers || {},
    };
    setModel(meta.model);
    setBackend(meta.backend);
    setReasoning(meta.reasoning_effort || "");
    setCredentialMode(mode);
    setApiKeyEnv(meta.api_key_env || "");
    setBaseUrl(meta.base_url);
    setHeaders(headersToText(meta.extra_headers));
    setBusy(false);
    setErr("");
  }

  const managedUrl = managedLaunchBaseUrl(backend);
  const baseLocked = !!managedUrl;
  const credLocked = !!managedUrl;
  const effectiveCredMode = credLocked ? "none" : credentialMode;
  const displayBaseUrl = managedUrl || baseUrl;

  const submit = async () => {
    if (busy) return;
    let patch;
    try {
      patch = buildSettingsPatch(
        {
          model,
          backend,
          base_url: baseUrl,
          reasoning_effort: reasoning,
          credential_mode: credentialMode,
          api_key_env: apiKeyEnv,
          extra_headers: headers,
        },
        {
          ...initial.current,
          extra_headers: initial.current.extra_headers || {},
        },
      );
    } catch (validationError) {
      setErr(validationError.message);
      return;
    }

    if (Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      onClose();
      return;
    }

    setBusy(true);
    setErr("");
    try {
      await updateConfig(id, patch);
      toast.success("Session settings saved");
      onClose();
    } catch (e) {
      const busyConflict = /HTTP 409/.test(e.message);
      toast.error(busyConflict ? "Session is busy — try again after the run finishes" : `Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const footer = html`
    <${Button} variant=${ButtonVariant.Tertiary} content=${ButtonContent.Text} onClick=${onClose} disabled=${busy}>
      Cancel
    </${Button}>
    <${Button} variant=${ButtonVariant.Primary} content=${ButtonContent.Text} onClick=${submit} loading=${busy}>
      Save
    </${Button}>
  `;

  return html`<${Modal} open=${open} onClose=${onClose} title="Session settings" size=${ModalSize.Medium} footer=${footer}>
    <div class="flex flex-col gap-4">
      ${diagnostics.length > 0
        ? html`<div class="rounded-lg border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary">
            <div class="label-small mb-1">Repair required</div>
            ${diagnostics.map((d, i) => html`<div key=${i}>• ${d}</div>`)}
          </div>`
        : null}
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
        <${Input} label="Model" value=${model} onInput=${(e) => setModel(e.target.value)} />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <${Field} label="Reasoning effort">
          <${Select} items=${REASONING_OPTIONS} value=${reasoning} onValueChange=${setReasoning} className="w-full" panelClassName="max-h-64 overflow-auto" />
        </${Field}>
        <${Input}
          label="Base URL"
          value=${displayBaseUrl}
          isDisabled=${baseLocked}
          hintText=${baseLocked ? "Managed by the selected backend." : undefined}
          onInput=${(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <${Field} label="Credentials">
          <${Select}
            items=${SETTINGS_CREDENTIAL_OPTIONS}
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
      <${Field} label="Extra headers (JSON)">
        <textarea
          class="input rounded-[4px] px-3 py-2 font-mono text-micro resize-none min-h-[80px]"
          spellcheck="false"
          placeholder='{ "X-Header": "value" }'
          value=${headers}
          onInput=${(e) => setHeaders(e.target.value)}
        ></textarea>
      </${Field}>
      ${err ? html`<p class="text-error-primary text-micro">${err}</p>` : null}
    </div>
  </${Modal}>`;
}
