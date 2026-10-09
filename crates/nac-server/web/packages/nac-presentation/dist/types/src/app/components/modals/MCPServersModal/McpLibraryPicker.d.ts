import { type ReactNode } from "react";
import type { McpLibraryEntry } from "../../../types/api";
/**
 * The curated catalog. Embedded in the binary today; entries will later come
 * from a remote index, so the picker treats the list as data either way.
 */
export declare function LibraryPicker({ onPick, onCustom, onClose, setFooter, }: {
    onPick: (entry: McpLibraryEntry) => void;
    onCustom: () => void;
    /**
     * Dismisses the whole dialog from a Close button in the surrounding footer.
     * A phone panel shows the catalog as a dialog of its own, whose header
     * already leads with the way out, so there both of these are left off.
     */
    onClose?: () => void;
    setFooter?: (footer: ReactNode) => void;
}): import("react").JSX.Element;
