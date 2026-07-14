import { React, html } from "../../lib/html.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Input } from "../../atoms/input.js";
import { Select } from "../../atoms/select.js";
import { Button, ButtonVariant, ButtonContent, ButtonSize } from "../../atoms/button.js";
import { createSession, useStoreInfo } from "../../store/sessionsStore.js";
import { selectSession } from "../../store/selectionStore.js";
import { useToast } from "../../providers/ToastProvider.js";
import { BACKEND_OPTIONS, REASONING_OPTIONS } from "./options.js";

const { useState, useEffect } = React;

function Field({ label, children }) {
  return html`<div class="flex flex-col gap-1">
    <label class="label-small text-basic-secondary">${label}</label>
    ${children}
  </div>`;
}

export function LaunchModal({ open, onClose }) {
  const storeInfo = useStoreInfo();
  const toast = useToast();
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");
  const [backend, setBackend] = useState("auto");
  const [reasoning, setReasoning] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCwd((storeInfo && storeInfo.root_cwd) || "");
      setModel("");
      setBackend("auto");
      setReasoning("");
      setApiKeyEnv("");
      setBaseUrl("");
      setAdvanced(false);
      setBusy(false);
    }
  }, [open, storeInfo]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = {};
      if (cwd.trim()) payload.cwd = cwd.trim();
      if (model.trim()) payload.model = model.trim();
      if (backend && backend !== "auto") payload.backend = backend;
      if (reasoning) payload.reasoning_effort = reasoning;
      if (apiKeyEnv.trim()) payload.api_key_env = apiKeyEnv.trim();
      if (baseUrl.trim()) payload.base_url = baseUrl.trim();
      const snap = await createSession(payload);
      const newId = snap && ((snap.metadata && snap.metadata.session_id) || snap.session_id);
      if (newId) selectSession(newId);
      toast.success("Session created");
      onClose();
    } catch (e) {
      toast.error(`Failed to create session: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

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
      <${Input}
        label="Working directory (cwd)"
        placeholder="/path/to/project"
        hintText="Defaults to the store root directory."
        value=${cwd}
        onInput=${(e) => setCwd(e.target.value)}
      />
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
        ? html`<div class="flex flex-col gap-4 pl-1 border-l border-secondary">
            <div class="pl-3 flex flex-col gap-4">
              <${Field} label="Reasoning effort">
                <${Select} items=${REASONING_OPTIONS} value=${reasoning} onValueChange=${setReasoning} className="w-full" />
              </${Field}>
              <${Input}
                label="API key env var (api_key_env)"
                placeholder="OPENAI_API_KEY"
                value=${apiKeyEnv}
                onInput=${(e) => setApiKeyEnv(e.target.value)}
              />
              <${Input}
                label="Base URL"
                placeholder="https://api.openai.com/v1 (empty = default)"
                value=${baseUrl}
                onInput=${(e) => setBaseUrl(e.target.value)}
              />
            </div>
          </div>`
        : null}
    </div>
  </${Modal}>`;
}
