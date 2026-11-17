import { IconName } from "@/app/atoms";
import type { SettingsSection } from "@/app/lib/routes";

export const REPO_URL = "https://github.com/arcee-ai/nac";
export const DOCS_URL = "https://github.com/arcee-ai/nac#readme";

export type SettingsGroupName = "App" | "Agents" | "Connections" | "Help";

export interface SettingsSectionMeta {
  id: SettingsSection;
  label: string;
  group: SettingsGroupName;
  icon: IconName;
  /** Lead line under the section title. */
  description: string;
  /** Row names the search field also matches, shown as hints when it does. */
  rows: readonly string[];
  /** Wide sections hold a list-and-form manager instead of rows. */
  wide?: boolean;
}

/** Every Settings section, in navigation order. Managed host is gated by the caller. */
export const SETTINGS_SECTION_META: readonly SettingsSectionMeta[] = [
  {
    id: "general",
    label: "General",
    group: "App",
    icon: IconName.Gear,
    description: "An overview of this NAC: what is set up, and where to change it.",
    rows: ["Overview", "Model setups", "Command palette"],
  },
  {
    id: "appearance",
    label: "Appearance",
    group: "App",
    icon: IconName.Sun,
    description: "How NAC looks on this device. Changes apply immediately.",
    rows: [
      "Theme",
      "System",
      "Light",
      "Dark",
      "Dark mode",
      "Transcript density",
      "Compact",
      "Detailed",
    ],
  },
  {
    id: "models",
    label: "Models & providers",
    group: "Agents",
    icon: IconName.Ai,
    description:
      "Reusable provider and model setups. Project and session defaults change only when you choose them.",
    rows: [
      "Configurations",
      "Model provider",
      "API key",
      "Base URL",
      "Default model",
      "Reasoning effort",
      "Context limit",
      "Light model",
      "Extra headers",
      "Initial prompt",
      "Model authentication",
    ],
    wide: true,
  },
  {
    id: "mcp",
    label: "MCP servers",
    group: "Agents",
    icon: IconName.Server,
    description: "Tools your agents can reach over the Model Context Protocol.",
    rows: ["Add server", "Custom server", "OAuth", "Headers", "Environment", "Arguments"],
    wide: true,
  },
  {
    id: "capabilities",
    label: "Capabilities",
    group: "Agents",
    icon: IconName.Features,
    description: "NAC capabilities: current product facts for this runtime and session.",
    rows: ["NAC capabilities", "Version", "Build", "Execution backend", "Skills", "Tools"],
  },
  {
    id: "ssh",
    label: "SSH hosts",
    group: "Connections",
    icon: IconName.Globe,
    description:
      "Saved connection details for the NAC server. Testing a connection is always explicit.",
    rows: ["SSH configs", "Host", "Port", "Identity file", "Test connection"],
    wide: true,
  },
  {
    id: "managed",
    label: "Managed host",
    group: "Connections",
    icon: IconName.Controls,
    description: "This managed host's status, its GitHub connection and its secrets.",
    rows: ["Status", "GitHub", "Secrets", "Upgrade"],
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    group: "Help",
    icon: IconName.Bolt,
    description: "Every keyboard shortcut. Press ⌘/ anywhere to see this list.",
    rows: ["Keyboard shortcuts", "Command palette"],
  },
  {
    id: "about",
    label: "About",
    group: "Help",
    icon: IconName.Info,
    description: "Version, build and where this NAC keeps its data.",
    rows: ["Version", "Build", "Store path", "Docs", "GitHub"],
  },
];

export const SETTINGS_GROUPS: readonly { name: SettingsGroupName; label: string | null }[] = [
  { name: "App", label: "App" },
  { name: "Agents", label: "Agents" },
  { name: "Connections", label: "Connections" },
  { name: "Help", label: null },
];

export function sectionMeta(id: SettingsSection): SettingsSectionMeta {
  // SAFETY: the table lists every SettingsSection value.
  return SETTINGS_SECTION_META.find((meta) => meta.id === id) as SettingsSectionMeta;
}

export interface SectionMatch {
  meta: SettingsSectionMeta;
  /** Row names that matched, when the section name itself did not. */
  rows: string[];
}

/** Sections (and their rows) that a search query names. Empty query → all. */
export function matchSections(
  sections: readonly SettingsSectionMeta[],
  query: string,
): SectionMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections.map((meta) => ({ meta, rows: [] }));
  const result: SectionMatch[] = [];
  for (const meta of sections) {
    const own =
      meta.label.toLowerCase().includes(needle) || meta.description.toLowerCase().includes(needle);
    const rows = meta.rows.filter((row) => row.toLowerCase().includes(needle));
    if (own || rows.length) result.push({ meta, rows: own ? [] : rows });
  }
  return result;
}
