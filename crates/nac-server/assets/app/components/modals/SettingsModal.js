import { React, html } from "../../lib/html.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Input } from "../../atoms/input.js";
import { Select } from "../../atoms/select.js";
import { Button, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { updateConfig, useSnapshot } from "../../store/sessionsStore.js";
import { useToast } from "../../providers/ToastProvider.js";
import { BACKEND_OPTIONS, REASONING_OPTIONS } from "./options.js";

const { useState, useEffect, useRef } = React;

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

export function SettingsModal({ open, onClose, id }) {
  const snap = useSnapshot(id);
  const toast = useToast();
  const initial = useRef({});
  const [model, setModel] = useState("");
  const [backend, setBackend] = useState("auto");
  const [reasoning, setReasoning] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !snap) return;
    // Frontend snapshot nests session config under `metadata`.
    const meta = snap.metadata || snap;
    const init = {
      model: meta.model || "",
      backend: meta.backend || "auto",
      reasoning: meta.reasoning_effort || "",
      apiKeyEnv: meta.api_key_env || "",
      baseUrl: meta.base_url || "",
      headers: headersToText(meta.extra_headers),
    };
    initial.current = init;
    setModel(init.model);
    setBackend(init.backend);
    setReasoning(init.reasoning);
    setApiKeyEnv(init.apiKeyEnv);
    setBaseUrl(init.baseUrl);
    setHeaders(init.headers);
    setBusy(false);
    setErr("");
  }, [open, id, snap && snap.metadata && snap.metadata.session_id]);

  const submit = async () => {
    if (busy) return;
    const init = initial.current;
    const payload = {};
    if (model !== init.model) payload.model = model.trim();
    if (backend !== init.backend) payload.backend = backend;
    if (reasoning !== init.reasoning) payload.reasoning_effort = reasoning;
    if (apiKeyEnv !== init.apiKeyEnv) payload.api_key_env = apiKeyEnv.trim();
    if (baseUrl !== init.baseUrl) payload.base_url = baseUrl.trim();
    if (headers !== init.headers) {
      const trimmed = headers.trim();
      if (trimmed) {
        try {
          JSON.parse(trimmed);
        } catch (_) {
          setErr("Headers must be a valid JSON object.");
          return;
        }
      }
      payload.extra_headers = trimmed; // "" clears the map on the backend
    }

    if (Object.keys(payload).length === 0) {
      toast.info("No changes to save");
      onClose();
      return;
    }

    setBusy(true);
    setErr("");
    try {
      await updateConfig(id, payload);
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
      <${Field} label="Reasoning effort">
        <${Select} items=${REASONING_OPTIONS} value=${reasoning} onValueChange=${setReasoning} className="w-full" />
      </${Field}>
      <${Input}
        label="API key env var (api_key_env)"
        placeholder="OPENAI_API_KEY"
        value=${apiKeyEnv}
        onInput=${(e) => setApiKeyEnv(e.target.value)}
      />
      <${Input} label="Base URL" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)} />
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
