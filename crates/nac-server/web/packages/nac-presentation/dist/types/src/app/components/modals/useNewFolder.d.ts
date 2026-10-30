import { type BrowseSource } from "../../services/queries";
interface NewFolderOptions {
    source: BrowseSource;
    /** The directory being listed, which is where the folder is made. */
    parent: string | null;
    /**
     * Changes whenever an answer stops belonging to what the person sees: a
     * different directory, source or opening of the picker.
     */
    binding: string;
    /** Called with the server's path once the folder certainly exists. */
    onCreated: (path: string) => void;
}
/**
 * Where the inline New folder form stands. `uncertain-*` states follow a
 * request whose answer was lost, so the folder may or may not exist; the form
 * looks before it offers the same name again and never replays on its own.
 */
export type NewFolderStatus = {
    kind: "editing";
} | {
    kind: "creating";
    name: string;
} | {
    kind: "refused";
    name: string;
    error: Error;
} | {
    kind: "checking";
    name: string;
    cause: Error;
} | {
    kind: "uncertain-exists";
    name: string;
    path: string;
    cause: Error;
} | {
    kind: "uncertain-absent";
    name: string;
    cause: Error;
} | {
    kind: "uncertain-unknown";
    name: string;
    cause: Error;
    check: Error;
};
/**
 * State for the picker's inline New folder form: one explicit request per
 * Create, made in the listed directory and bound to it, so a late answer for a
 * directory, source or picker the person has left is dropped.
 */
export declare function useNewFolder({ source, parent, binding, onCreated }: NewFolderOptions): {
    open: boolean;
    start: () => void;
    cancel: () => void;
    name: string;
    setName: import("react").Dispatch<import("react").SetStateAction<string>>;
    status: NewFolderStatus;
    pending: boolean;
    /** Create is withheld only while the same name's outcome is unknown. */
    blocked: boolean;
    submit: () => void;
    checkAgain: () => void;
};
export {};
