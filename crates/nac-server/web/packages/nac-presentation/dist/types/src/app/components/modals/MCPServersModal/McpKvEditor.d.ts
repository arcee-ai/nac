import type { KvRow } from "../../../lib/mcpKvRows";
export declare function KvEditor({ label, hint, keyPlaceholder, rows, onChange, }: {
    label: string;
    hint: string;
    keyPlaceholder: string;
    rows: KvRow[];
    onChange: (rows: KvRow[]) => void;
}): import("react").JSX.Element;
