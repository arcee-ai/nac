import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { FormSection } from "@/app/components/modals/FormSection";
import { managedQueryKeys, useManagedGitHub } from "@/app/features/managed/queries";
import { cn } from "@/app/lib/cn";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { githubErrorText } from "./managedErrorText";

import type { ManagedGitHubLoginStarted } from "@/app/types/api";

export function ManagedGitHubPanel({ onConnected }: { onConnected?: () => void }) {
  const { api } = useNativeRuntime();

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
            // Publish the authoritative profile before removing the device prompt.
            // Background normalization must not briefly offer Connect GitHub again.
            client.setQueryData(managedQueryKeys.github, state.auth);
            setLogin(null);
            setLoginError("");
            void Promise.all([
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
          if (!controller.signal.aborted) setLoginError(githubErrorText(error));
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
  }, [login, client, onConnected, toast, api]);

  const connect = async () => {
    setBusy(true);
    setLoginError("");
    try {
      setLogin(await api.startManagedGitHubLogin());
    } catch (error) {
      setLoginError(githubErrorText(error));
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

  if (github.isPending)
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 text-small text-basic-secondary"
      >
        <Loader size={LoaderSize.Small} />
        Checking GitHub connection…
      </div>
    );
  return (
    <div data-testid="managed-github-settings">
      <FormSection
        title="GitHub"
        description="Connect the private Arcee GitHub App. Tokens are never shown in NAC."
      >
        {github.error ? (
          <div className="flex flex-col items-start gap-3 text-small !leading-[22px] text-error-primary">
            <p role="alert">{githubErrorText(github.error)}</p>
            <Button
              className="min-h-11"
              variant={ButtonVariant.Secondary}
              content={ButtonContent.Text}
              onClick={() => void github.refetch()}
              loading={github.isFetching}
            >
              Retry connection check
            </Button>
          </div>
        ) : null}
        {!github.error && github.data?.configured === false ? (
          <p role="status" className="text-small !leading-[22px] text-basic-secondary">
            GitHub App is not configured on this host.
          </p>
        ) : null}
        {!github.error && github.data?.connected ? (
          <div className="border-y border-basic py-4">
            <div className="flex flex-wrap items-center gap-3">
              {github.data.avatar_url ? (
                <img src={github.data.avatar_url} alt="" className="h-10 w-10 rounded-full" />
              ) : (
                <Icon iconName={IconName.Github} />
              )}
              <div className="min-w-0 flex-1">
                <p className="label-medium text-basic-primary break-words">
                  {github.data.name ?? github.data.login}
                </p>
                <p className="text-small !leading-[22px] text-basic-secondary break-words">
                  @{github.data.login}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 label-small text-success-primary">
                <Icon iconName={IconName.CheckCircle} aria-hidden="true" />
                Connected
              </span>
            </div>
            {github.data.git_name && github.data.git_email ? (
              <p className="mt-3 text-small !leading-[22px] text-basic-secondary">
                Git commits: {github.data.git_name} · {github.data.git_email}
              </p>
            ) : null}
          </div>
        ) : null}
        {login ? (
          <div className="rounded-lg border border-basic p-4" data-testid="github-device-code">
            <p className="label-medium text-basic-primary">Authorize this host on GitHub</p>
            <p className="mt-1 text-small !leading-[22px] text-basic-secondary">
              Open GitHub and enter this code. Returning here will preserve this pending login.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 basis-32 break-all rounded bg-elevation-level-2 px-4 py-3 text-center text-xl tracking-[0.2em] text-basic-primary">
                {login.user_code}
              </code>
              <CopyButton
                className="min-h-11 min-w-11"
                value={login.user_code}
                title="Copy device code"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className={cn(
                  "btn min-h-11 max-w-full !whitespace-normal",
                  ButtonSize.Medium,
                  ButtonVariant.Primary,
                  ButtonContent.IconRight,
                )}
                href={login.verification_uri}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GitHub <Icon iconName={IconName.External} />
              </a>
              <Button
                className="min-h-11 max-w-full !whitespace-normal"
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
        {loginError ? (
          <p role="alert" className="text-small !leading-[22px] text-error-primary">
            {loginError}
          </p>
        ) : null}
        {!login && !github.error ? (
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 max-w-full !whitespace-normal"
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              onClick={() => void connect()}
              loading={busy}
            >
              {github.data?.connected ? "Reconnect GitHub" : "Connect GitHub"}
            </Button>
            {github.data?.connected ? (
              <Button
                className="min-h-11 max-w-full !whitespace-normal"
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
      </FormSection>
    </div>
  );
}
