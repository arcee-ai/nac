import { IconName } from "../../atoms";
import type { SettingsSection } from "../../lib/routes";
export declare const REPO_URL = "https://github.com/arcee-ai/nac";
export declare const DOCS_URL = "https://github.com/arcee-ai/nac#readme";
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
export declare const SETTINGS_SECTION_META: readonly SettingsSectionMeta[];
export declare const SETTINGS_GROUPS: readonly {
    name: SettingsGroupName;
    label: string | null;
}[];
export declare function sectionMeta(id: SettingsSection): SettingsSectionMeta;
export interface SectionMatch {
    meta: SettingsSectionMeta;
    /** Row names that matched, when the section name itself did not. */
    rows: string[];
}
/** Sections (and their rows) that a search query names. Empty query → all. */
export declare function matchSections(sections: readonly SettingsSectionMeta[], query: string): SectionMatch[];
