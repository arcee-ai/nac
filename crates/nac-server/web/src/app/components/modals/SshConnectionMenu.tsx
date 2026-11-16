import { useId } from "react";
import type React from "react";

import { Icon, IconName, TabButton, TabButtonSize, TabButtonVariant } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { useSshAliases } from "@/app/services/queries";

import type { OpenSshAliasList, SshConfigurationRecord } from "@/app/types/api";

export interface SshConnectionMenuProps {
  configurations: SshConfigurationRecord[];
  /** The saved profile in use, or null while drafting a new connection. */
  selectedConfigId: string | null;
  /** The OpenSSH alias the current draft started from, if any. */
  selectedAlias: string | null;
  isMobile: boolean;
  onCreateNew: () => void;
  onPickConfig: (configId: string) => void;
  onPickAlias: (alias: string) => void;
}

function MenuGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col [&>*]:shrink-0">
      <div className="flex flex-col px-2 pt-2 pb-1">
        <p id={titleId} className="label-micro text-basic-muted">
          {title}
        </p>
        {subtitle ? <p className="text-micro text-basic-tertiary">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-micro text-basic-muted">{children}</p>;
}

/**
 * What the alias group says about itself. Discovery never fails loudly: an
 * unreadable config still leaves manual entry and saved profiles working, so
 * every outcome here is a quiet hint rather than an error.
 */
function aliasHints(data: OpenSshAliasList | undefined, failed: boolean): string[] {
  if (failed) return ["Couldn't read the NAC server's SSH config. Type a host under Create New."];
  if (!data) return [];
  const hints: string[] = [];
  if (data.aliases.length === 0) {
    hints.push("No literal Host aliases found on the NAC server.");
  }
  if (data.undiscoverable_patterns > 0) {
    const count = data.undiscoverable_patterns;
    hints.push(
      `${count} wildcard or negated ${count === 1 ? "pattern isn't" : "patterns aren't"} listed; type a matching host under Create New.`,
    );
  }
  if (data.warnings.length > 0) {
    hints.push(
      "Some of the config could not be read or is conditional, so this list may be partial.",
    );
  }
  return hints;
}

/**
 * The SSH connection picker: start a new connection, reuse a saved NAC
 * profile, or start from an OpenSSH alias the NAC server already knows. The
 * alias group reads the server machine's config, which is not necessarily the
 * machine this browser runs on, and says so.
 */
export function SshConnectionMenu({
  configurations,
  selectedConfigId,
  selectedAlias,
  isMobile,
  onCreateNew,
  onPickConfig,
  onPickAlias,
}: SshConnectionMenuProps) {
  const aliases = useSshAliases();
  const size = isMobile ? TabButtonSize.Large : TabButtonSize.Medium;
  const creatingNew = selectedConfigId === null && selectedAlias === null;
  const hints = aliasHints(aliases.data, aliases.isError);

  return (
    <div
      className={cn(
        "flex flex-col min-h-0",
        isMobile ? "w-full flex-1 px-2" : "w-[320px] max-h-96",
      )}
    >
      <div className="flex flex-col shrink-0 [&>*]:shrink-0">
        <TabButton
          size={size}
          variant={creatingNew ? TabButtonVariant.Accent : TabButtonVariant.Regular}
          active={creatingNew}
          onClick={onCreateNew}
        >
          <Icon iconName={IconName.Add} />
          <span className="text-left flex-grow">Create New</span>
        </TabButton>
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0">
        <div className="h-px w-full bg-divider-muted my-1" />
        <MenuGroup title="Saved NAC profiles">
          {configurations.length === 0 ? <Hint>No saved profiles yet.</Hint> : null}
          {configurations.map((entry) => (
            <TabButton
              key={entry.config_id}
              size={size}
              variant={
                selectedConfigId === entry.config_id
                  ? TabButtonVariant.Accent
                  : TabButtonVariant.Regular
              }
              active={selectedConfigId === entry.config_id}
              onClick={() => onPickConfig(entry.config_id)}
            >
              <Icon iconName={IconName.Globe} />
              <span className="text-left flex-grow truncate">{entry.name}</span>
            </TabButton>
          ))}
        </MenuGroup>
        <div className="h-px w-full bg-divider-muted my-1" />
        <MenuGroup title="OpenSSH aliases" subtitle="from the NAC server's ~/.ssh/config">
          {aliases.isPending ? <Hint>Reading the NAC server's SSH config…</Hint> : null}
          {(aliases.data?.aliases ?? []).map((alias) => (
            <TabButton
              key={alias}
              size={size}
              variant={selectedAlias === alias ? TabButtonVariant.Accent : TabButtonVariant.Regular}
              active={selectedAlias === alias}
              onClick={() => onPickAlias(alias)}
            >
              <Icon iconName={IconName.Terminal} />
              <span className="text-left flex-grow truncate">{alias}</span>
            </TabButton>
          ))}
          {hints.map((hint) => (
            <Hint key={hint}>{hint}</Hint>
          ))}
        </MenuGroup>
      </div>
    </div>
  );
}
