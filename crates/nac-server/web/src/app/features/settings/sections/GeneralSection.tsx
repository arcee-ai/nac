import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { IconName, KeyboardShortcut } from "@/app/atoms";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { routes } from "@/app/lib/routes";
import { COMMAND_PALETTE_KEYS, SHORTCUT_SHEET_KEYS } from "@/app/lib/shortcuts";
import { useTheme } from "@/app/providers/ThemeProvider";
import { useMcpServers, useModelConfigs, useSshConfigs } from "@/app/services/queries";

import { SettingsGroup, SettingsLinkRow, SettingsRow } from "../SettingsRows";

const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" } as const;

function count(value: number | undefined, one: string, many: string): string {
  if (value === undefined) return "…";
  if (value === 0) return `No ${many}`;
  return `${value} ${value === 1 ? one : many}`;
}

/**
 * Settings › General. NAC has no global launch defaults of its own — a session
 * starts from a saved setup chosen in the composer — so this is the overview:
 * what is configured, with a way into each section.
 */
export function GeneralSection() {
  const managed = useManagedHost();
  const { theme = "system" } = useTheme();
  const { useTranscriptDensity } = useNativeRuntime().stores.transcriptDensityStore;
  const density = useTranscriptDensity();
  const { data: models } = useModelConfigs();
  const { data: mcp } = useMcpServers();
  const { data: ssh } = useSshConfigs();
  const servers = mcp?.servers;
  const active = servers?.filter((server) => server.enabled).length;
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Agents"
        description="New sessions pick a saved setup in the composer; nothing here changes a running session."
      >
        <SettingsLinkRow
          label="Models & providers"
          hint="Saved provider and model setups"
          value={count(models?.configurations.length, "setup", "setups")}
          to={routes.settings("models")}
          icon={IconName.Ai}
        />
        <SettingsLinkRow
          label="MCP servers"
          hint="Tools agents can reach"
          value={
            servers === undefined
              ? "…"
              : servers.length === 0
                ? "None"
                : `${active} of ${servers.length} on`
          }
          to={routes.settings("mcp")}
          icon={IconName.Server}
        />
        <SettingsLinkRow
          label="Capabilities"
          hint="What this runtime offers"
          to={routes.settings("capabilities")}
          icon={IconName.Features}
        />
      </SettingsGroup>
      <SettingsGroup title="Connections">
        <SettingsLinkRow
          label="SSH hosts"
          hint="Remote machines sessions can run on"
          value={count(ssh?.configurations.length, "host", "hosts")}
          to={routes.settings("ssh")}
          icon={IconName.Globe}
        />
        {managed.isManaged ? (
          <SettingsLinkRow
            label="Managed host"
            hint="Status, GitHub and secrets"
            value={managed.status?.github_status === "connected" ? "GitHub connected" : undefined}
            to={routes.settings("managed")}
            icon={IconName.Controls}
          />
        ) : null}
      </SettingsGroup>
      <SettingsGroup title="This device">
        <SettingsLinkRow
          label="Appearance"
          hint={`Transcript: ${density === "compact" ? "Compact" : "Detailed"}`}
          value={THEME_LABEL[theme]}
          to={routes.settings("appearance")}
          icon={IconName.Sun}
        />
        <SettingsRow
          label="Command palette"
          icon={IconName.Search}
          hint="Jump to any session, project, setting or action."
          control={<KeyboardShortcut keys={COMMAND_PALETTE_KEYS} />}
        />
        <SettingsRow
          label="Keyboard shortcuts"
          icon={IconName.Bolt}
          hint="See every shortcut."
          control={<KeyboardShortcut keys={SHORTCUT_SHEET_KEYS} />}
        />
      </SettingsGroup>
    </div>
  );
}
