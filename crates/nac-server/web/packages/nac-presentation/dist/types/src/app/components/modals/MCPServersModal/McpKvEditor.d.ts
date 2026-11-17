import type { KvRow } from "../../../lib/mcpKvRows";
export declare function KvEditor({ label, hint, keyPlaceholder, rows, onChange, secret, }: {
    label: string;
    hint: string;
    keyPlaceholder: string;
    secret?: boolean;
    rows: KvRow[];
    onChange: (rows: KvRow[]) => void;
}): import("react").JSX.Element;
