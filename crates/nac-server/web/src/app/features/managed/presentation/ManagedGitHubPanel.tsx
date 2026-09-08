import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { managedQueryKeys, useManagedGitHub } from "@/app/features/managed/queries";
import { StatusDot } from "@/app/features/managed/presentation/ManagedStatusPanel";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type { ManagedGitHubLoginStarted } from "@/app/types/api";

export function ManagedGitHubPanel({ onConnected }: { onConnected?: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const github = useManagedGitHub();
  const [login, setLogin] = useState<ManagedGitHubLoginStarted | null>(null);
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!login) return undefined;
    let stopped = false;
    const controller = new AbortController();
    const poll = async () => {
      while (!stopped) {
        try {
          const state = await api.pollManagedGitHubLogin(login.login_id, controller.signal);
          if (state.state === "complete") {
            setLogin(null);
            setLoginError("");
            await Promise.all([
              client.invalidateQueries({ queryKey: managedQueryKeys.github }),
              client.invalidateQueries({ queryKey: managedQueryKeys.hostStatus }),
            ]);
            toast.success("GitHub connected");
            onConnected?.();
            return;
          }
          if (state.state === "failed") {
            setLoginError(state.error);
            setLogin(null);
            return;
          }
        } catch (error) {
          if (!controller.signal.aborted) setLoginError(humanErrorText(toRunError(error)));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [login, client, onConnected, toast]);

  const connect = async () => {
    setBusy(true);
    setLoginError("");
    try {
      setLogin(await api.startManagedGitHubLogin());
    } catch (error) {
      setLoginError(humanErrorText(toRunError(error)));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.disconnectManagedGitHub();
      await Promise.all([
        client.invalidateQueries({ queryKey: managedQueryKeys.github }),
        client.invalidateQueries({ queryKey: managedQueryKeys.hostStatus }),
      ]);
      toast.success("GitHub disconnected");
    } catch (error) {
      toast.error(`Disconnect failed: ${errorMessage(toRunError(error))}`);
    } finally {
      setBusy(false);
    }
  };

  if (github.isLoading) return <Loader size={LoaderSize.Medium} />;
  return (
    <div className="flex flex-col gap-5" data-testid="managed-github-settings">
      <div>
        <p className="header-xl text-basic-primary">GitHub</p>
        <p className="text-small text-basic-tertiary">
          Connect the private Arcee GitHub App. Tokens are never shown in NAC.
        </p>
      </div>
      {github.data?.connected ? (
        <div className="rounded-lg border border-basic p-4">
          <div className="flex items-center gap-3">
            {github.data.avatar_url ? (
              <img src={github.data.avatar_url} alt="" className="h-10 w-10 rounded-full" />
            ) : (
              <Icon iconName={IconName.Github} />
            )}
            <div className="min-w-0 flex-1">
              <p className="label-medium text-basic-primary truncate">
                {github.data.name ?? github.data.login}
              </p>
              <p className="text-small text-basic-tertiary truncate">@{github.data.login}</p>
            </div>
            <StatusDot ready />
          </div>
          {github.data.git_name && github.data.git_email ? (
            <p className="mt-3 text-small text-basic-tertiary">
              Git commits: {github.data.git_name} · {github.data.git_email}
            </p>
          ) : null}
        </div>
      ) : null}
      {login ? (
        <div className="rounded-lg border border-info-primary p-4" data-testid="github-device-code">
          <p className="label-medium text-basic-primary">Authorize this host on GitHub</p>
          <p className="mt-1 text-small text-basic-tertiary">
            Open GitHub and enter this code. Returning here will preserve this pending login.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <code className="flex-1 rounded bg-elevation-level-2 px-4 py-3 text-center text-xl tracking-[0.2em] text-basic-primary">
              {login.user_code}
            </code>
            <CopyButton value={login.user_code} title="Copy device code" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={ButtonVariant.Primary}
              content={ButtonContent.IconRight}
              onClick={() => window.open(login.verification_uri, "_blank", "noopener")}
            >
              Open GitHub <Icon iconName={IconName.External} />
            </Button>
            <Button
              variant={ButtonVariant.Tertiary}
              content={ButtonContent.Text}
              onClick={() => {
                void api.cancelManagedGitHubLogin(login.login_id);
                setLogin(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {loginError ? <p className="text-small text-error-primary">{loginError}</p> : null}
      {!login ? (
        <div className="flex gap-2">
          <Button
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={() => void connect()}
            loading={busy}
          >
            {github.data?.connected ? "Reconnect GitHub" : "Connect GitHub"}
          </Button>
          {github.data?.connected ? (
            <Button
              variant={ButtonVariant.SecondaryDestructive}
              content={ButtonContent.Text}
              onClick={() => void disconnect()}
              disabled={busy}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
