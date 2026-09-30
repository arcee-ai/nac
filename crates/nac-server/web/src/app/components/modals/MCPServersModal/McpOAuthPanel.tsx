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

type OAuthStatus =
  | "needs_configuration"
  | "needs_authorization"
  | "connecting"
  | "connected"
  | "failed";

interface OAuthStatusResponse {
  status: OAuthStatus;
  message?: string;
}

interface AuthenticateResponse {
  status: OAuthStatus;
  authorization_url: string;
}

async function oauthRequest<T>(path: string, method: "GET" | "POST", body?: object): Promise<T> {
  const response =
    method === "GET"
      ? await fetch(path, { method: "GET" })
      : await fetch(path, {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
  if (!response.ok) throw new Error("The OAuth request could not be completed.");
  return (await response.json()) as T;
}

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
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [clientIdCredential, setClientIdCredential] = useState("");
  const [clientSecretCredential, setClientSecretCredential] = useState("");
  const [scopes, setScopes] = useState("channels:history\nchat:write");
  const base = `/mcp_library/servers/${encodeURIComponent(serverName)}/oauth`;

  const refresh = useCallback(
    async (retrying = false) => {
      try {
        const response = await oauthRequest<OAuthStatusResponse>(`${base}/status`, "GET");
        setStatus(response.status);
        setMessage(response.message ?? null);
      } catch {
        if (!retrying) setStatus("failed");
        setMessage(
          retrying
            ? "OAuth status is temporarily unavailable. Retrying…"
            : "OAuth status is unavailable.",
        );
      }
    },
    [base],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (status !== "connecting") return;
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
    if (!clientIdCredential.trim() || !clientSecretCredential.trim()) {
      setMessage("Both protected credential names are required.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await oauthRequest<OAuthStatusResponse>(`${base}/configure`, "POST", {
        client_id_credential: clientIdCredential.trim(),
        client_secret_credential: clientSecretCredential.trim(),
        scopes: scopes
          .split("\n")
          .map((scope) => scope.trim())
          .filter(Boolean),
      });
      setStatus(response.status);
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
      const response = await oauthRequest<AuthenticateResponse>(`${base}/authenticate`, "POST");
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
      const response = await oauthRequest<OAuthStatusResponse>(`${base}/logout`, "POST");
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
              <FieldLabel label="Client secret credential" required />
              <Input
                inputSize={isMobile ? InputSize.Large : InputSize.Medium}
                value={clientSecretCredential}
                placeholder="SLACK_MCP_CLIENT_SECRET"
                onChange={(event) => setClientSecretCredential(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel label="Scopes" hint="One scope per line." />
            <TextArea
              textAreaClassName="min-h-[64px] font-mono text-small"
              value={scopes}
              onChange={(event) => setScopes(event.target.value)}
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
          Continue authorization in Slack
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
