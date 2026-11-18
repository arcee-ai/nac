import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { PathPickerModal } from "@/app/components/modals/PathPickerModal";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useSshConfigs } from "@/app/services/queries";
import type { SshTarget } from "@/app/types/api";

/** A folder a project works in, on this computer or on an SSH host. */
export interface SourceFolder {
  path: string;
  ssh: SshTarget | null;
}

type Machine =
  | { kind: "local" }
  | { kind: "ssh"; target: SshTarget; label: string }
  | { kind: "new-ssh" };

const LOCAL: Machine = { kind: "local" };

function sameFolder(a: SourceFolder, b: SourceFolder) {
  return (
    a.path === b.path &&
    (a.ssh?.ssh_host ?? null) === (b.ssh?.ssh_host ?? null) &&
    (a.ssh?.ssh_port ?? null) === (b.ssh?.ssh_port ?? null)
  );
}

function folderName(path: string) {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

function machineLabel(machine: Machine) {
  if (machine.kind === "local") return "this computer";
  if (machine.kind === "ssh") return machine.label;
  return "a new SSH host";
}

/**
 * Lists a project's folders and adds more. Each folder picks its own machine,
 * so one project can span this computer and SSH hosts.
 */
export function SourceFolders({
  folders,
  onChange,
  defaultCwd,
  invalid = false,
  disabled = false,
}: {
  folders: SourceFolder[];
  onChange: (folders: SourceFolder[]) => void;
  defaultCwd: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();
  const sshConfigs = useSshConfigs();
  const [machine, setMachine] = useState<Machine>(LOCAL);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const target = machine.kind === "ssh" ? machine.target : null;
  const canAdd = !disabled && machine.kind !== "new-ssh";
  const empty = folders.length === 0;
  const local = machine.kind === "local";
  const usedLocal = folders.some((folder) => !folder.ssh && folder.path === defaultCwd);

  const choose = (next: Machine) => {
    setMachine(next);
    setMenuOpen(false);
  };

  const add = (path: string) => {
    setPicking(false);
    const folder = { path, ssh: target };
    if (!folders.some((existing) => sameFolder(existing, folder))) onChange([...folders, folder]);
  };

  const tabSize = isMobile ? TabButtonSize.Large : TabButtonSize.Medium;
  const menu = (
    <div className={cn("flex flex-col", isMobile ? "w-full px-2" : "w-[260px] max-h-72")}>
      <TabButton
        size={tabSize}
        variant={TabButtonVariant.Regular}
        active={machine.kind === "local"}
        onClick={() => choose(LOCAL)}
      >
        <Icon iconName={IconName.Desktop} />
        <span className="text-left flex-grow">This computer</span>
      </TabButton>
      {(sshConfigs.data?.configurations ?? []).map((config) => {
        const configTarget: SshTarget = {
          ssh_host: config.ssh_host,
          ssh_port: config.ssh_port ?? null,
          ssh_identity_file: config.ssh_identity_file ?? null,
        };
        return (
          <TabButton
            key={config.config_id}
            size={tabSize}
            variant={TabButtonVariant.Regular}
            active={machine.kind === "ssh" && machine.label === config.name}
            onClick={() => choose({ kind: "ssh", target: configTarget, label: config.name })}
          >
            <Icon iconName={IconName.Server} />
            <span className="text-left flex-grow truncate">{config.name}</span>
            <span className="shrink-0 truncate text-micro text-basic-muted">{config.ssh_host}</span>
          </TabButton>
        );
      })}
      <div className="h-px w-full bg-divider-muted my-1 shrink-0" />
      <TabButton
        size={tabSize}
        variant={TabButtonVariant.Regular}
        active={machine.kind === "new-ssh"}
        onClick={() => choose({ kind: "new-ssh" })}
      >
        <Icon iconName={IconName.Add} />
        <span className="text-left flex-grow">New SSH host…</span>
      </TabButton>
    </div>
  );

  const addRow = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1 gap-y-3",
        empty ? "flex-col justify-center" : "justify-between",
      )}
    >
      <div className="flex items-center gap-0.5 text-small text-basic-secondary">
        <span>Add a folder on</span>
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement={PopoverPlacement.BottomLeft}
          size="w-auto"
          content={menu}
        >
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Small}
            content={ButtonContent.IconRight}
            className="text-basic-primary"
            disabled={disabled}
            aria-expanded={menuOpen}
            aria-label={`Folder location: ${machineLabel(machine)}`}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span className="truncate max-w-[180px]">{machineLabel(machine)}</span>
            <Icon
              iconName={IconName.Down}
              className={cn(
                "transition-transform duration-150 ease-out",
                menuOpen ? "rotate-180" : "rotate-0",
              )}
            />
          </Button>
        </Popover>
      </div>
      <Button
        variant={ButtonVariant.Secondary}
        size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
        content={ButtonContent.IconLeft}
        disabled={!canAdd}
        onClick={() => setPicking(true)}
      >
        <Icon iconName={IconName.Add} />
        Add folder
      </Button>
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col rounded-card border",
        invalid ? "border-error-primary" : "border-tertiary",
        empty && "border-dashed",
      )}
    >
      {folders.length > 0 ? (
        <ul className="flex flex-col" aria-label="Source folders">
          {folders.map((folder) => (
            <li
              key={`${folder.ssh?.ssh_host ?? ""}:${folder.path}`}
              className="flex items-center gap-3 px-4 py-3 border-muted [&:not(:first-child)]:border-t"
            >
              <Icon
                iconName={folder.ssh ? IconName.Server : IconName.Folder}
                className="shrink-0 text-basic-secondary"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-small text-basic-primary truncate">
                  {folderName(folder.path)}
                </span>
                <span className="text-micro text-basic-muted truncate">
                  {folder.ssh ? `${folder.ssh.ssh_host}:${folder.path}` : folder.path}
                </span>
              </div>
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Small}
                content={ButtonContent.Icon}
                aria-label={`Remove ${folder.path}`}
                disabled={disabled}
                onClick={() => onChange(folders.filter((existing) => existing !== folder))}
              >
                <Icon iconName={IconName.Close} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className={cn("px-4", empty ? "py-8" : "py-3 border-t border-muted")}>
        {addRow}
        {machine.kind === "new-ssh" ? (
          <SshConnectionBox
            mode="launch"
            connection={null}
            className="pt-4"
            onConnectionChange={(next) => {
              if (next) setMachine({ kind: "ssh", target: next, label: next.ssh_host });
            }}
          />
        ) : null}
      </div>

      <PathPickerModal
        open={picking}
        kind="directory"
        nativeLocalDirectory={local}
        initialPath={local && !usedLocal ? defaultCwd : ""}
        ssh={target}
        onClose={() => setPicking(false)}
        onSelect={add}
      />
    </div>
  );
}
