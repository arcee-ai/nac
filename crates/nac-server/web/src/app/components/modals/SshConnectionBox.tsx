import { useMemo, useState } from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
  Popover,
  PopoverPlacement,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { FieldLabel } from "@/app/components/modals/ConfigRow";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { cn } from "@/app/lib/cn";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCreateSshConfig,
  useSshConfigs,
  useSshConnect,
} from "@/app/services/queries";
import {
  markSshConnected,
  markSshDisconnected,
} from "@/app/store/sshConnectionStore";
import type { SshConfigurationRecord, SshTarget } from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

const CREATE_NEW = "__new__";

/**
 * What an empty identity file means: ssh resolves the key itself, from
 * `~/.ssh/config` and the agent. Shown in place of a path so the default reads
 * as a choice rather than as a blank.
 */
const DEFAULT_KEY_LABEL = ".ssh/config";

/** Where the key picker opens: beside the current key, or in the ssh directory. */
function keyDirectory(identityFile: string): string {
  const trimmed = identityFile.trim();
  if (!trimmed) return "~/.ssh";
  return trimmed.replace(/\/[^/]*$/, "") || "/";
}

/** OpenSSH accepts 1-65535; anything else is rejected before the request. */
function sshPortError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return "Port must be an integer between 1 and 65535.";
  }
  return null;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function targetFromFields(
  host: string,
  port: string,
  key: string,
): SshTarget | { error: string } {
  const sshHost = nullable(host);
  if (!sshHost) return { error: "An SSH host is required." };
  const portErr = sshPortError(port);
  if (portErr) return { error: portErr };
  return {
    ssh_host: sshHost,
    ssh_port: nullable(port) ? Number(port.trim()) : null,
    ssh_identity_file: nullable(key),
  };
}

function nextDefaultName(configurations: SshConfigurationRecord[]): string {
  const taken = new Set(configurations.map((entry) => entry.name));
  let n = configurations.length + 1;
  while (taken.has(`SSH-config-${n}`)) n += 1;
  return `SSH-config-${n}`;
}

function targetsMatch(
  left: SshTarget,
  right: Pick<
    SshConfigurationRecord,
    "ssh_host" | "ssh_port" | "ssh_identity_file"
  >,
): boolean {
  return (
    left.ssh_host === right.ssh_host &&
    (left.ssh_port ?? null) === (right.ssh_port ?? null) &&
    (left.ssh_identity_file ?? null) === (right.ssh_identity_file ?? null)
  );
}

export type SshConnectionBoxMode = "launch" | "settings" | "manage";

export interface SshConnectionBoxProps {
  mode: SshConnectionBoxMode;
  /** Launch/settings: the live connected target, or null when disconnected. */
  connection: SshTarget | null;
  onConnectionChange: (target: SshTarget | null, homePath?: string) => void;
  /**
   * Settings: seed the draft (and matching saved config, when one exists) from
   * the session's persisted SSH target while disconnected.
   */
  seedTarget?: SshTarget | null;
  /** Manage mode: controlled form fields. */
  name?: string;
  onNameChange?: (name: string) => void;
  host?: string;
  onHostChange?: (host: string) => void;
  port?: string;
  onPortChange?: (port: string) => void;
  identityFile?: string;
  onIdentityFileChange?: (path: string) => void;
  /** Manage mode: run a connectivity test without changing connection state. */
  onTest?: () => Promise<void>;
  testing?: boolean;
  /** When true, fields stay read-only (connected or parent disabled). */
  locked?: boolean;
  className?: string;
}

/**
 * Shared SSH form: pick or create a saved config, connect (and auto-persist a
 * new one), or — in manage mode — edit fields with a Test action.
 */
export function SshConnectionBox({
  mode,
  connection,
  onConnectionChange,
  seedTarget = null,
  name: controlledName,
  onNameChange,
  host: controlledHost,
  onHostChange,
  port: controlledPort,
  onPortChange,
  identityFile: controlledKey,
  onIdentityFileChange,
  onTest,
  testing = false,
  locked = false,
  className,
}: SshConnectionBoxProps) {
  const toast = useToast();
  const { data } = useSshConfigs();
  const configurations = useMemo(() => data?.configurations ?? [], [data]);
  const createConfig = useCreateSshConfig();
  const connect = useSshConnect();

  const isManage = mode === "manage";
  const matchedSeedId = useMemo(() => {
    if (isManage || !seedTarget?.ssh_host.trim()) return null;
    return (
      configurations.find((entry) => targetsMatch(seedTarget, entry))
        ?.config_id ?? null
    );
  }, [isManage, seedTarget, configurations]);

  // Null means "follow the seed match"; a concrete id is the user's pick.
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const selectedId = userSelectedId ?? matchedSeedId ?? CREATE_NEW;
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftName, setDraftName] = useState(() =>
    nextDefaultName(configurations),
  );
  const [draftHost, setDraftHost] = useState(seedTarget?.ssh_host ?? "");
  const [draftPort, setDraftPort] = useState(
    seedTarget?.ssh_port ? String(seedTarget.ssh_port) : "",
  );
  const [draftKey, setDraftKey] = useState(seedTarget?.ssh_identity_file ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pickingKey, setPickingKey] = useState(false);

  const isMobile = useIsMobile();
  const connected = Boolean(connection);
  const busy = connect.isPending || createConfig.isPending || testing;
  const fieldsLocked = locked || connected || busy;

  const selectedConfig =
    selectedId === CREATE_NEW
      ? null
      : (configurations.find((entry) => entry.config_id === selectedId) ??
        null);

  const name = isManage ? (controlledName ?? "") : draftName;
  const host = isManage
    ? (controlledHost ?? "")
    : connected
      ? (connection?.ssh_host ?? "")
      : draftHost;
  const port = isManage
    ? (controlledPort ?? "")
    : connected
      ? connection?.ssh_port
        ? String(connection.ssh_port)
        : ""
      : draftPort;
  const identityFile = isManage
    ? (controlledKey ?? "")
    : connected
      ? (connection?.ssh_identity_file ?? "")
      : draftKey;

  const setName = (value: string) => {
    if (isManage) onNameChange?.(value);
    else setDraftName(value);
  };
  const setHost = (value: string) => {
    if (isManage) onHostChange?.(value);
    else setDraftHost(value);
  };
  const setPort = (value: string) => {
    if (isManage) onPortChange?.(value);
    else setDraftPort(value);
  };
  const setKey = (value: string) => {
    if (isManage) onIdentityFileChange?.(value);
    else setDraftKey(value);
  };

  const selectorLabel =
    selectedId === CREATE_NEW
      ? "Create New"
      : (selectedConfig?.name ?? "SSH config");

  const pickConfig = (id: string) => {
    setUserSelectedId(id);
    setMenuOpen(false);
    setError(null);
    if (id === CREATE_NEW) {
      setDraftName(nextDefaultName(configurations));
      setDraftHost(seedTarget?.ssh_host ?? "");
      setDraftPort(seedTarget?.ssh_port ? String(seedTarget.ssh_port) : "");
      setDraftKey(seedTarget?.ssh_identity_file ?? "");
      return;
    }
    const entry = configurations.find((row) => row.config_id === id);
    if (!entry) return;
    setDraftName(entry.name);
    setDraftHost(entry.ssh_host);
    setDraftPort(entry.ssh_port ? String(entry.ssh_port) : "");
    setDraftKey(entry.ssh_identity_file ?? "");
  };

  const runConnect = async () => {
    setError(null);
    const parsed = targetFromFields(host, port, identityFile);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (selectedId === CREATE_NEW && !nullable(name)) {
      setError("An SSH config name is required.");
      return;
    }
    try {
      const listing = await connect.mutateAsync(parsed);
      markSshConnected(parsed);
      if (selectedId === CREATE_NEW) {
        const created = await createConfig.mutateAsync({
          name: name.trim(),
          ssh_host: parsed.ssh_host,
          ssh_port: parsed.ssh_port ?? null,
          ssh_identity_file: parsed.ssh_identity_file ?? null,
        });
        setUserSelectedId(created.config_id);
      }
      onConnectionChange(parsed, listing.path);
    } catch (connectError) {
      markSshDisconnected(parsed);
      const message = errorMessage(connectError);
      setError(message);
      toast.error(`SSH connect failed: ${message}`);
    }
  };

  const runDisconnect = () => {
    if (connection) markSshDisconnected(connection);
    onConnectionChange(null);
    setError(null);
  };

  const runTest = async () => {
    if (!onTest) return;
    setError(null);
    try {
      await onTest();
    } catch (testError) {
      const message = errorMessage(testError);
      setError(message);
    }
  };

  const showNameField = isManage || (!connected && selectedId === CREATE_NEW);
  const showSelector = !isManage;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[8px] overflow-hidden shadow-convex",
        connected ? "bg-info-primary" : "bg-elevation-sublevel-variant-A",
        className,
      )}
    >
      {showSelector ? (
        <div className="flex items-center gap-4 h-12 pl-3 pr-1.5 py-1 border-b border-muted bg-elevation-sublevel-variant-A">
          <p className="label-small text-basic-primary flex-1 min-w-0">
            SSH config
          </p>
          {connected ? (
            <Badge
              text="Connected"
              color={BadgeColor.Blue}
              className="!py-0.5 !px-1"
            />
          ) : null}
          <Popover
            open={menuOpen && !fieldsLocked}
            onClose={() => setMenuOpen(false)}
            placement={PopoverPlacement.BottomLeft}
            size="w-auto"
            className="shrink-0"
            panelClassName="max-h-72 overflow-hidden"
            sheetClassName="overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col"
            content={
              <div
                className={cn(
                  "flex flex-col min-h-0",
                  isMobile ? "w-full flex-1 px-2" : "w-[280px] max-h-72",
                )}
              >
                <div className="flex flex-col shrink-0 [&>*]:shrink-0">
                  <TabButton
                    size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
                    variant={
                      selectedId === CREATE_NEW
                        ? TabButtonVariant.Accent
                        : TabButtonVariant.Regular
                    }
                    active={selectedId === CREATE_NEW}
                    onClick={() => pickConfig(CREATE_NEW)}
                  >
                    <Icon iconName={IconName.Add} />
                    <span className="text-left flex-grow">Create New</span>
                  </TabButton>
                </div>
                {configurations.length > 0 ? (
                  <div className="flex flex-col flex-1 min-h-0 min-w-0">
                    <div className="h-px w-full bg-divider-muted my-1 shrink-0" />
                    <div className="flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0">
                      {configurations.map((entry) => (
                        <TabButton
                          key={entry.config_id}
                          size={
                            isMobile
                              ? TabButtonSize.Large
                              : TabButtonSize.Medium
                          }
                          variant={
                            selectedId === entry.config_id
                              ? TabButtonVariant.Accent
                              : TabButtonVariant.Regular
                          }
                          active={selectedId === entry.config_id}
                          onClick={() => pickConfig(entry.config_id)}
                        >
                          <Icon iconName={IconName.Globe} />
                          <span className="text-left flex-grow truncate">
                            {entry.name}
                          </span>
                        </TabButton>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            }
          >
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Secondary}
              disabled={fieldsLocked}
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
            >
              <span className="truncate max-w-[140px]">{selectorLabel}</span>
              <Icon
                iconName={IconName.Down}
                className={cn(
                  "shrink-0 transition-transform duration-150 ease-out",
                  menuOpen ? "rotate-180" : "rotate-0",
                )}
              />
            </Button>
          </Popover>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 p-3">
        {showNameField ? (
          <div className="flex flex-col gap-1 w-full">
            <FieldLabel label="SSH config name" required />
            <Input
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
              value={name}
              isDisabled={fieldsLocked}
              onChange={(e) => setName(e.target.value)}
              placeholder="SSH-config-1"
            />
          </div>
        ) : null}

        <div className="flex flex-col md:flex-row gap-4 items-start w-full">
          <div className="flex flex-col gap-1 w-full md:flex-1 min-w-0">
            <FieldLabel
              label="SSH Host"
              required
              hint="user@host, a host alias from ~/.ssh/config, or an IP."
            />
            <Input
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
              value={host}
              isDisabled={fieldsLocked}
              onChange={(e) => setHost(e.target.value)}
              placeholder="example@192.0.2.10 or build-box"
            />
          </div>
          <div className="flex flex-col gap-1 w-full md:w-[98px] shrink-0">
            <FieldLabel
              label="Port"
              hint="Blank uses OpenSSH's default (usually 22)."
            />
            <Input
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
              value={port}
              isDisabled={fieldsLocked}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
            />
          </div>
        </div>

        <div className="flex gap-4 items-end w-full">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <FieldLabel
              label="Private Key"
              hint="A key file on this machine. The default leaves the choice to your ~/.ssh/config and ssh agent."
            />
            <Button
              size={ButtonSize.Medium}
              variant={ButtonVariant.Secondary}
              className="w-full"
              disabled={fieldsLocked}
              onClick={() => setPickingKey(true)}
            >
              <span className="flex-1 min-w-0 truncate text-left">
                {identityFile.trim() || DEFAULT_KEY_LABEL}
              </span>
              <Icon iconName={IconName.FolderOpen} size={20} />
            </Button>
          </div>
          <div className="md:w-[128px] shrink-0 relative">
            {isManage ? (
              <Button
                size={ButtonSize.Medium}
                variant={ButtonVariant.Secondary}
                className="w-full"
                disabled={busy}
                onClick={() => void runTest()}
              >
                {testing ? (
                  <Loader size={LoaderSize.Small} />
                ) : (
                  <Icon iconName={IconName.Bolt} size={20} />
                )}
                Test
              </Button>
            ) : connected ? (
              <Button
                size={ButtonSize.Medium}
                variant={ButtonVariant.Ghost}
                className="w-full"
                onClick={runDisconnect}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size={ButtonSize.Medium}
                variant={ButtonVariant.Primary}
                className="w-full"
                disabled={busy}
                onClick={() => void runConnect()}
              >
                {busy ? <Loader size={LoaderSize.Small} /> : null}
                Connect
              </Button>
            )}
          </div>
        </div>

        {error ? (
          <p className="text-micro text-error-primary">{error}</p>
        ) : null}
      </div>

      {/* The key is read by this machine's ssh client, so it is always browsed
          locally — never on the host being connected to. */}
      <PathPickerModal
        open={pickingKey}
        kind="file"
        title="Select Private Key"
        showHidden
        initialPath={keyDirectory(identityFile)}
        clearLabel={`Use ${DEFAULT_KEY_LABEL}`}
        onClear={() => {
          setKey("");
          setPickingKey(false);
        }}
        onClose={() => setPickingKey(false)}
        onSelect={(path) => {
          setKey(path);
          setPickingKey(false);
        }}
      />
    </div>
  );
}
