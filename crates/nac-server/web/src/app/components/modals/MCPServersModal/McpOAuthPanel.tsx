import { useCallback, useEffect, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Input,
  InputSize,
  TextArea,
} from "@/app/atoms";
import { FieldLabel } from "@/app/components/modals/ConfigRow";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ConfigureMcpOAuthRequest } from "../../../../../packages/nac-client/src/types.js";
import type { ApiSchema } from "@/app/types/openapi.generated";
type OAuthStatus = ApiSchema<"McpOAuthPublicStatus">;

function statusLabel(status: OAuthStatus | null): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Waiting for authorization";
    case "failed":
      return "Authorization failed";
    case "needs_authorization":
      return "Ready to connect";
    case "needs_configuration":
      return "Not configured";
    default:
      return "Checking…";
  }
}

export function McpOAuthPanel({ serverName }: { serverName: string }) {
  const { api } = useNativeRuntime();
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [clientIdCredential, setClientIdCredential] = useState("");
  const [clientSecretCredential, setClientSecretCredential] = useState("");
  const [registrationType, setRegistrationType] = useState<
    "pre_registered" | "client_metadata" | "dynamic"
  >("pre_registered");
  const [clientMetadataUrl, setClientMetadataUrl] = useState("");
  const [clientName, setClientName] = useState("NAC MCP Client");
  const [scopes, setScopes] = useState("channels:history\nchat:write");
  const [metadataOverride, setMetadataOverride] = useState("");

  const refresh = useCallback(
    async (retrying = false) => {
      try {
        const response = await api.getMcpOAuthStatus(serverName);
        setStatus(response.status);
        setMessage(response.message ?? null);
        setAuthorizationUrl(response.authorization_url ?? null);
      } catch {
        if (!retrying) setStatus("failed");
        setMessage(
          retrying
            ? "OAuth status is temporarily unavailable. Retrying…"
            : "OAuth status is unavailable.",
        );
      }
    },
    [api, serverName],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (status !== "connecting" && status !== "connected") return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh(true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1_000);
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh, status]);

  const configure = async () => {
    if (registrationType === "pre_registered" && !clientIdCredential.trim()) {
      setMessage("A protected client ID credential name is required.");
      return;
    }
    if (registrationType === "client_metadata" && !clientMetadataUrl.trim()) {
      setMessage("A client metadata document URL is required.");
      return;
    }
    let authorizationMetadata: ConfigureMcpOAuthRequest["authorization_metadata"];
    try {
      authorizationMetadata = metadataOverride.trim()
        ? (JSON.parse(metadataOverride) as ConfigureMcpOAuthRequest["authorization_metadata"])
        : undefined;
    } catch {
      setMessage("The authorization metadata override must be valid JSON.");
      return;
    }
    const registration: ConfigureMcpOAuthRequest["registration"] =
      registrationType === "pre_registered"
        ? {
            type: "pre_registered",
            client_id_credential: clientIdCredential.trim(),
            client_secret_credential: clientSecretCredential.trim() || undefined,
          }
        : registrationType === "client_metadata"
          ? { type: "client_metadata", url: clientMetadataUrl.trim() }
          : { type: "dynamic", client_name: clientName.trim() || undefined };
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.configureMcpOAuth(serverName, {
        registration,
        scopes: scopes
          .split("\n")
          .map((scope) => scope.trim())
          .filter(Boolean),
        authorization_metadata: authorizationMetadata,
      });
      setStatus(response.status);
      setAuthorizationUrl(response.authorization_url ?? null);
      setEditing(false);
      setClientIdCredential("");
      setClientSecretCredential("");
    } catch {
      setMessage("OAuth configuration was rejected. Check the protected credential names.");
    } finally {
      setBusy(false);
    }
  };

  const authenticate = async () => {
    setBusy(true);
    setMessage(null);
    setAuthorizationUrl(null);
    try {
      const response = await api.authenticateMcpOAuth(serverName);
      setStatus(response.status);
      setAuthorizationUrl(response.authorization_url);
    } catch {
      setStatus("failed");
      setMessage("OAuth authentication could not start.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setMessage(null);
    setAuthorizationUrl(null);
    try {
      const response = await api.logoutMcpOAuth(serverName);
      setStatus(response.status);
    } catch {
      setMessage("OAuth logout could not complete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-medium text-basic-primary">OAuth</div>
          <div className="text-small text-basic-muted">
            Authorization Code with PKCE. Tokens and callback state stay in protected local storage.
          </div>
        </div>
        <span className="text-small text-basic-muted">{statusLabel(status)}</span>
      </div>

      {status === "needs_configuration" || editing ? (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 md:col-span-2">
              <FieldLabel label="Client registration" required />
              <select
                className="h-10 rounded-md border border-border-subtle bg-elevation-surface px-3 text-small text-basic-primary"
                value={registrationType}
                onChange={(event) =>
                  setRegistrationType(
                    event.target.value as "pre_registered" | "client_metadata" | "dynamic",
                  )
                }
              >
                <option value="pre_registered">Pre-registered client</option>
                <option value="client_metadata">Client metadata document (SEP-991)</option>
                <option value="dynamic">Dynamic client registration</option>
              </select>
            </div>
            {registrationType === "pre_registered" ? (
              <>
                <div className="flex flex-col gap-1">
                  <FieldLabel label="Client ID credential" required />
                  <Input
                    inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                    value={clientIdCredential}
                    placeholder="SLACK_MCP_CLIENT_ID"
                    onChange={(event) => setClientIdCredential(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel
                    label="Client secret credential"
                    hint="Optional for public clients."
                  />
                  <Input
                    inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                    value={clientSecretCredential}
                    placeholder="SLACK_MCP_CLIENT_SECRET"
                    onChange={(event) => setClientSecretCredential(event.target.value)}
                  />
                </div>
              </>
            ) : null}
            {registrationType === "client_metadata" ? (
              <div className="flex flex-col gap-1 md:col-span-2">
                <FieldLabel label="Client metadata URL" required />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  value={clientMetadataUrl}
                  placeholder="https://nac.example.com/.well-known/oauth-client.json"
                  onChange={(event) => setClientMetadataUrl(event.target.value)}
                />
              </div>
            ) : null}
            {registrationType === "dynamic" ? (
              <div className="flex flex-col gap-1 md:col-span-2">
                <FieldLabel label="Client name" hint="Sent to the authorization server." />
                <Input
                  inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel label="Scopes" hint="One scope per line." />
            <TextArea
              textAreaClassName="min-h-[64px] font-mono text-small"
              value={scopes}
              onChange={(event) => setScopes(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel
              label="Authorization metadata override"
              hint="Optional JSON for servers without discovery metadata."
            />
            <TextArea
              textAreaClassName="min-h-[72px] font-mono text-small"
              value={metadataOverride}
              placeholder={
                registrationType === "client_metadata"
                  ? '{"authorization_endpoint":"https://…","token_endpoint":"https://…","client_id_metadata_document_supported":true}'
                  : '{"authorization_endpoint":"https://…","token_endpoint":"https://…"}'
              }
              onChange={(event) => setMetadataOverride(event.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Secondary}
              content={ButtonContent.Text}
              disabled={busy}
              onClick={() => void configure()}
            >
              Configure OAuth
            </Button>
          </div>
        </>
      ) : null}

      {status && status !== "needs_configuration" && status !== "connecting" && !editing ? (
        <div className="flex justify-end">
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Text}
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit OAuth configuration
          </Button>
        </div>
      ) : null}

      {status === "needs_authorization" || status === "failed" ? (
        <div className="flex justify-end">
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            disabled={busy}
            onClick={() => void authenticate()}
          >
            Authenticate
          </Button>
        </div>
      ) : null}

      {authorizationUrl ? (
        <a
          className="text-small text-accent-primary underline self-end"
          href={authorizationUrl}
          target="_blank"
          rel="noreferrer"
        >
          Continue OAuth authorization
        </a>
      ) : null}

      {status === "connected" || status === "connecting" ? (
        <div className="flex justify-end">
          <Button
            size={ButtonSize.Medium}
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            disabled={busy}
            onClick={() => void logout()}
          >
            {status === "connected" ? "Log out" : "Cancel authorization"}
          </Button>
        </div>
      ) : null}

      {message ? <div className="text-small text-error-primary">{message}</div> : null}
    </div>
  );
}
