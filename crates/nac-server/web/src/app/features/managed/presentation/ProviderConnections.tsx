import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button, ButtonVariant, Input } from "@/app/atoms";
import { PROVIDER_KINDS, providerLabel, providerUsesApiKey } from "@/app/lib/providers";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries";
import type { BackendKind } from "@/app/types/api";
import { ManagedAuthCallout } from "./ManagedAuthCallout";

/** Provider accounts are independent of the model chosen for each session. */
export function ProviderConnections() {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const [backend, setBackend] = useState<BackendKind>("openai-responses");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [allowHttp, setAllowHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function connect() {
    if (busy || !key.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await api.createProviderConnection({
        backend,
        base_url: baseUrl.trim() || null,
        allow_insecure_http: allowHttp,
        api_key: key,
      });
      setKey("");
      await client.invalidateQueries({ queryKey: queryKeys.modelCatalog });
      setMessage("Provider connection saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the provider connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Provider connections" className="flex flex-col gap-4">
      <p className="text-small !leading-[22px] text-basic-secondary">
        Connect a provider here, then choose a model for each session.
      </p>
      <ManagedAuthCallout backend="arcee-auth" />
      <ManagedAuthCallout backend="chatgpt-codex-responses" />
      <label className="flex flex-col gap-1 text-small">
        Provider
        <select
          aria-label="Provider"
          value={backend}
          onChange={(event) => setBackend(event.target.value as BackendKind)}
          disabled={busy}
        >
          {PROVIDER_KINDS.filter(providerUsesApiKey).map((kind) => (
            <option key={kind} value={kind}>
              {providerLabel(kind)}
            </option>
          ))}
        </select>
      </label>
      <Input
        label="Endpoint URL (optional)"
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        disabled={busy}
      />
      <Input
        label="API key"
        type="password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        disabled={busy}
      />
      <label className="flex items-center gap-2 text-small">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center md:h-4 md:w-4">
          <input
            type="checkbox"
            className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            checked={allowHttp}
            onChange={(event) => setAllowHttp(event.target.checked)}
            disabled={busy}
          />
          <span
            aria-hidden="true"
            className="flex h-4 w-4 items-center justify-center rounded border border-current peer-focus-visible:outline peer-focus-visible:outline-2"
          >
            {allowHttp ? "✓" : null}
          </span>
        </span>
        Allow an insecure HTTP endpoint
      </label>
      <Button
        variant={ButtonVariant.Secondary}
        className="max-md:min-h-11"
        onClick={() => void connect()}
        disabled={busy || !key.trim()}
      >
        Save connection
      </Button>
      {message ? (
        <p role="status" className="text-small">
          {message}
        </p>
      ) : null}
    </section>
  );
}
