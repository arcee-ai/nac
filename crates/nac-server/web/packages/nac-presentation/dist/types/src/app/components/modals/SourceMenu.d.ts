export type Source = {
    kind: "catalog";
} | {
    kind: "new";
} | {
    kind: "file";
} | {
    kind: "saved";
    configId: string;
};
/** Create a setup, read one from a file, or reuse one saved earlier. */
export declare function SourceMenu({ label, configurations, activeId, source, onSelect, onDelete, }: {
    label: string;
    configurations: {
        id: string;
        name: string;
    }[];
    activeId: string | null;
    source: Source["kind"];
    onSelect: (source: Source) => void;
    onDelete: (id: string, name: string) => void;
}): import("react").JSX.Element;
