import { type ArgRow } from "../../../lib/mcpArgRows";
/** Ordered command arguments, one input per argument. */
export declare function ArgsEditor({ label, itemLabel, rows, onChange, }: {
    label: string;
    /** Names each row for assistive technology, e.g. "Argument" → "Argument 2". */
    itemLabel: string;
    rows: ArgRow[];
    onChange: (rows: ArgRow[]) => void;
}): import("react").JSX.Element;
