import { IconName } from "../../atoms";
import { type SessionStatus } from "../../lib/sessionStatus";
export type PaletteGroup = "Sessions" | "Session panels" | "Actions" | "Projects" | "New session in…" | "Settings" | "Theme" | "Transcript";
/** Group order in the list. Empty-query lists show a few of the long groups. */
export declare const PALETTE_GROUPS: readonly PaletteGroup[];
export interface PaletteItem {
    id: string;
    group: PaletteGroup;
    label: string;
    /** Second, quieter line or trailing context (project, "Subagent of …"). */
    detail?: string;
    /** Extra words the filter also matches. */
    keywords?: string;
    icon?: IconName;
    status?: SessionStatus;
    shortcut?: string[];
    /** Marks the current choice (theme, density, current session). */
    current?: boolean;
    /** Nested under a parent session. */
    child?: boolean;
    /** Recency for sessions; higher is newer. */
    recency?: number;
    run(): void;
}
/**
 * Everything the ⌘K palette can do, built from the same queries, stores and
 * owners the rest of the app uses. Nothing here runs on its own: each item's
 * `run` is called only when the user picks it.
 */
export declare function usePaletteCommands(): PaletteItem[];
