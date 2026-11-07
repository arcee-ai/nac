import { type ReactNode } from "react";
import type { McpLibraryEntry, McpServerView } from "../../../types/api";
export declare function McpServerForm({ record, template, libraryEntry, onBack, onClose, onSaved, onDeleted, isCurrent, setFooter, }: {
    record: McpServerView | null;
    template: McpLibraryEntry | null;
    libraryEntry: McpLibraryEntry | null;
    /**
     * Way back to the catalog, as a row above the fields. A phone panel opens
     * the form as a dialog of its own and leads its header with the same move,
     * so there it is left out.
     */
    onBack?: () => void;
    onClose: () => void;
    onSaved: (serverName: string) => void;
    onDeleted: () => void;
    /** The selection/opening that owns this render, captured by each async request. */
    isCurrent?: () => boolean;
    setFooter: (footer: ReactNode) => void;
}): import("react").JSX.Element;
