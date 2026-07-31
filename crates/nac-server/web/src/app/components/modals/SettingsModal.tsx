import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonVariant,
  Input,
  Modal,
  ModalSize,
  Select,
} from "@/app/atoms";
import {
  BACKEND_OPTIONS,
  REASONING_OPTIONS,
  SETTINGS_CREDENTIAL_OPTIONS,
} from "@/app/components/modals/options";
import {
  buildSettingsPatch,
  managedLaunchBaseUrl,
  type CredentialMode,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useSessionConfig,
  useSessionSnapshot,
  useUpdateConfig,
} from "@/app/services/queries";
import type { RawSessionConfig, SessionMetadata } from "@/app/types/api";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label-small text-basic-secondary">{label}</label>
      {children}
    </div>
  );
}

function headersToText(headers: Record<string, string>): string {
  return Object.keys(headers).length === 0 ? "" : JSON.stringify(headers, null, 2);
}

/** The persisted column is a JSON string; unparsable content means "repair me". */
function parseHeadersJson(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function initialFromMetadata(meta: SessionMetadata): SettingsInitialValues {
  return {
    model: meta.model,
    backend: meta.backend,
    base_url: meta.base_url ?? "",
    reasoning_effort: meta.reasoning_effort || null,
    api_key_env: meta.api_key_env || null,
    extra_headers: meta.extra_headers ?? {},
  };
}

function initialFromConfig(config: RawSessionConfig): SettingsInitialValues {
  return {
    model: config.model,
    backend: config.backend ?? "",
    base_url: config.base_url,
    reasoning_effort: config.reasoning_effort || null,
    api_key_env: config.api_key_env || null,
    extra_headers: parseHeadersJson(config.extra_headers_json),
  };
}

export function SettingsModal({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const { data: snapshot } = useSessionSnapshot(open ? id : null);
  // Fetched for diagnostics ("repair required") and as a fallback source when
  // the live snapshot is unavailable.
  const { data: config, isLoading } = useSessionConfig(open ? id : null);

  if (!open || !id) return null;

  const meta = snapshot?.metadata;
  const initial = meta
    ? initialFromMetadata(meta)
    : config
      ? initialFromConfig(config)
      : null;

  if (!initial) {
    return (
      <Modal open onClose={onClose} title="Session settings" size={ModalSize.Medium}>
        <p className="text-basic-muted text-micro">
          {isLoading
            ? "Loading session configuration…"
            : "Session configuration unavailable."}
        </p>
      </Modal>
    );
  }

  return (
    <SettingsForm
      id={id}
      initial={initial}
      diagnostics={config?.diagnostics ?? []}
      onClose={onClose}
    />
  );
}

/** Mounted only once the initial values are known, so the form owns its state. */
function SettingsForm({
  id,
  initial,
  diagnostics,
  onClose,
}: {
  id: string;
  initial: SettingsInitialValues;
  diagnostics: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const updateConfig = useUpdateConfig();

  const [model, setModel] = useState(initial.model);
  const [backend, setBackend] = useState(initial.backend);
  const [reasoning, setReasoning] = useState(initial.reasoning_effort ?? "");
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(
    initial.api_key_env ? "variable" : "none",
  );
  const [apiKeyEnv, setApiKeyEnv] = useState(initial.api_key_env ?? "");
  const [baseUrl, setBaseUrl] = useState(initial.base_url);
  const [headers, setHeaders] = useState(headersToText(initial.extra_headers));
  const [error, setError] = useState("");

  const managedUrl = managedLaunchBaseUrl(backend);
  const locked = Boolean(managedUrl);
  const effectiveCredMode: CredentialMode = locked ? "none" : credentialMode;
  const displayBaseUrl = managedUrl ?? baseUrl;
  const busy = updateConfig.isPending;

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
        initial,
      );
    } catch (validationError) {
      setError(errorMessage(validationError));
      return;
    }

    if (Object.keys(patch).length === 0) {
      toast.info("No changes to save");
      onClose();
      return;
    }

    setError("");
    try {
      await updateConfig.mutateAsync({ id, patch });
      toast.success("Session settings saved");
      onClose();
    } catch (saveError) {
      const message = errorMessage(saveError);
      toast.error(
        /HTTP 409/.test(message)
          ? "Session is busy — try again after the run finishes"
          : `Error: ${message}`,
      );
    }
  };

  const footer = (
    <>
      <Button
        variant={ButtonVariant.Tertiary}
        content={ButtonContent.Text}
        onClick={onClose}
        disabled={busy}
      >
        Cancel
      </Button>
      <Button
        variant={ButtonVariant.Primary}
        content={ButtonContent.Text}
        onClick={submit}
        loading={busy}
      >
        Save
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Session settings"
      size={ModalSize.Medium}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {diagnostics.length > 0 ? (
          <div className="rounded-lg border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary">
            <div className="label-small mb-1">Repair required</div>
            {diagnostics.map((diagnostic) => (
              <div key={diagnostic}>• {diagnostic}</div>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Backend">
            <Select
              items={BACKEND_OPTIONS}
              value={backend}
              onValueChange={setBackend}
              className="w-full"
              panelClassName="max-h-64 overflow-auto"
            />
          </Field>
          <Input label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reasoning effort">
            <Select
              items={REASONING_OPTIONS}
              value={reasoning}
              onValueChange={setReasoning}
              className="w-full"
              panelClassName="max-h-64 overflow-auto"
            />
          </Field>
          <Input
            label="Base URL"
            value={displayBaseUrl}
            isDisabled={locked}
            hintText={locked ? "Managed by the selected backend." : undefined}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Credentials">
            <Select
              items={SETTINGS_CREDENTIAL_OPTIONS}
              value={effectiveCredMode}
              onValueChange={(value) => setCredentialMode(value as CredentialMode)}
              disabled={locked}
              className="w-full"
            />
          </Field>
          <Input
            label="API key env var"
            placeholder="OPENAI_API_KEY"
            value={apiKeyEnv}
            isDisabled={locked || effectiveCredMode !== "variable"}
            onChange={(e) => setApiKeyEnv(e.target.value)}
          />
        </div>

        <Field label="Extra headers (JSON)">
          <textarea
            className="input rounded-[4px] px-3 py-2 font-mono text-micro resize-none min-h-[80px]"
            spellCheck={false}
            placeholder='{ "X-Header": "value" }'
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
          />
        </Field>

        {error ? <p className="text-error-primary text-micro">{error}</p> : null}
      </div>
    </Modal>
  );
}
