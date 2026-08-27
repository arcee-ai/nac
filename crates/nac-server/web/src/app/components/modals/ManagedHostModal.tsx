import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
  Modal,
  ModalSize,
  Separator,
} from "@/app/atoms";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import {
  queryKeys,
  useDeleteManagedSecret,
  useManagedGitHub,
  useManagedHostStatus,
  useManagedSecrets,
  usePutManagedSecret,
} from "@/app/services/queries";
import type { ManagedGitHubLoginStarted } from "@/app/types/api";

type ManagedTab = "status" | "github" | "secrets";

const RESERVED_NAMES = new Set([
  "PATH",
  "HOME",
  "NAC_HOME",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "EXA_API_KEY",
]);

function secretNameError(name: string): string {
  if (!name) return "Enter a variable name.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use letters, digits, and underscores; the first character cannot be a digit.";
  }
  if (RESERVED_NAMES.has(name)) return `${name} is managed by NAC and cannot be replaced here.`;
  return "";
}

function StatusDot({ ready }: { ready: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${ready ? "bg-success-primary" : "bg-warning-primary"}`}
    />
  );
}

export function ManagedHostModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<ManagedTab>("status");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Managed host"
      size={ModalSize.Large}
      flush
      className="h-[min(760px,calc(100vh-32px))]"
    >
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2">
          {(["status", "github", "secrets"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded px-3 py-2 text-left label-small capitalize ${tab === item ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`}
              onClick={() => setTab(item)}
            >
              {item === "github" ? "GitHub" : item}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          {tab === "status" ? <ManagedStatusPanel /> : null}
          {tab === "github" ? <ManagedGitHubPanel /> : null}
          {tab === "secrets" ? <ManagedSecretsPanel /> : null}
        </div>
      </div>
    </Modal>
  );
}

function ManagedStatusPanel() {
  const status = useManagedHostStatus();
  if (status.isLoading) return <Loader size={LoaderSize.Medium} />;
  if (!status.data) {
    return <p className="text-error-primary">Managed host status is unavailable.</p>;
  }
  const host = status.data;
  return (
    <div className="flex flex-col gap-5" data-testid="managed-host-status">
      <div>
        <p className="header-xl text-basic-primary">{host.logical_host_id}</p>
        <p className="text-small text-basic-tertiary">Managed NAC · {host.public_hostname}</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatusCard
          label="Arcee model"
          value={host.model_ready ? "Ready" : "Needs attention"}
          ready={host.model_ready}
        />
        <StatusCard
          label="GitHub"
          value={host.github_status.replace("-", " ")}
          ready={host.github_status === "connected"}
        />
        <StatusCard label="Projects" value={String(host.project_count)} ready />
        <StatusCard label="Host secrets" value={String(host.secret_count)} ready />
      </div>
      <div className="rounded-lg bg-elevation-level-2 p-4">
        <p className="label-small text-basic-secondary">Repository root</p>
        <p className="code-small break-all text-basic-primary">{host.repository_root}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="label-medium text-basic-primary">Readiness</p>
          <span className="text-small text-basic-tertiary">
            v{host.version} · schema {host.schema_version}
          </span>
        </div>
        {host.checks.map((check) => (
          <div
            key={check.name}
            className="flex items-start gap-2 rounded-lg border border-basic p-3"
          >
            <span className="mt-2">
              <StatusDot ready={check.ready} />
            </span>
            <div className="min-w-0">
              <p className="label-small text-basic-primary">{check.name}</p>
              <p className="text-small text-basic-tertiary break-words">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusCard({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="rounded-lg border border-basic p-4">
      <p className="text-small text-basic-tertiary">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <StatusDot ready={ready} />
        <p className="label-medium capitalize text-basic-primary">{value}</p>
      </div>
    </div>
  );
}

function ManagedGitHubPanel() {
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
              client.invalidateQueries({ queryKey: queryKeys.managedGitHub }),
              client.invalidateQueries({ queryKey: queryKeys.managedHostStatus }),
            ]);
            toast.success("GitHub connected");
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
  }, [login, client, toast]);

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
        client.invalidateQueries({ queryKey: queryKeys.managedGitHub }),
        client.invalidateQueries({ queryKey: queryKeys.managedHostStatus }),
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

function ManagedSecretsPanel() {
  const secrets = useManagedSecrets();
  const put = usePutManagedSecret();
  const remove = useDeleteManagedSecret();
  const toast = useToast();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [attempted, setAttempted] = useState(false);
  const validation = useMemo(() => (attempted ? secretNameError(name) : ""), [attempted, name]);

  const save = async () => {
    setAttempted(true);
    const invalid = secretNameError(name);
    if (invalid || value.length === 0) return;
    try {
      await put.mutateAsync({ name, value });
      setName("");
      setValue("");
      setAttempted(false);
      toast.success("Secret saved for future command spawns");
    } catch (error) {
      toast.error(`Secret was not saved: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="managed-secrets-settings">
      <div>
        <p className="header-xl text-basic-primary">Host secrets</p>
        <p className="text-small text-basic-tertiary">
          Values are write-only and are injected into every newly spawned agent command on this
          single-owner host. Running processes keep their existing snapshot.
        </p>
      </div>
      <div className="rounded-lg border border-warning-primary p-4 text-small text-basic-secondary">
        Agents have arbitrary shell access and can print injected values. Add only secrets trusted
        across every Project and agent on this host.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          inputSize={InputSize.Large}
          label="Variable name"
          aria-label="Variable name"
          placeholder="SERVICE_TOKEN"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setAttempted(false);
          }}
          validation={Boolean(validation)}
          validationText={validation}
          autoCapitalize="none"
          spellCheck={false}
        />
        <Input
          inputSize={InputSize.Large}
          label="New value"
          aria-label="New value"
          placeholder="Write-only value"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          validation={attempted && value.length === 0}
          validationText="Enter a value."
          autoComplete="new-password"
        />
      </div>
      <div>
        <Button
          variant={ButtonVariant.Primary}
          content={ButtonContent.Text}
          onClick={() => void save()}
          loading={put.isPending}
        >
          Save secret
        </Button>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <p className="label-medium text-basic-primary">Stored names</p>
        {secrets.isLoading ? <Loader size={LoaderSize.Small} /> : null}
        {secrets.data?.secrets.length === 0 ? (
          <p className="text-small text-basic-tertiary">No host secrets saved.</p>
        ) : null}
        {secrets.data?.secrets.map((secret) => (
          <div
            key={secret.name}
            className="flex items-center gap-3 rounded-lg border border-basic p-3"
          >
            <Icon iconName={IconName.Key} />
            <code className="min-w-0 flex-1 truncate text-basic-primary">{secret.name}</code>
            <span className="text-small text-basic-muted">value hidden</span>
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Small}
              content={ButtonContent.Icon}
              aria-label={`Delete ${secret.name}`}
              onClick={async () => {
                try {
                  await remove.mutateAsync(secret.name);
                  toast.success(`${secret.name} removed from future command spawns`);
                } catch (error) {
                  toast.error(`Secret was not removed: ${errorMessage(toRunError(error))}`);
                }
              }}
              loading={remove.isPending}
            >
              <Icon iconName={IconName.Trash} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
