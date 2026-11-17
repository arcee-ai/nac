import type { useNewFolder } from "./useNewFolder";
type NewFolder = ReturnType<typeof useNewFolder>;
/**
 * The inline form behind the picker's New folder button. It names one folder
 * inside the listed directory; the server decides whether that name is
 * acceptable, and its answer is shown here with the form left open.
 */
export declare function PathPickerNewFolder({ folder, onOpen, }: {
    folder: NewFolder;
    /** Browses into a folder the form found after an unconfirmed create. */
    onOpen: (path: string) => void;
}): import("react").JSX.Element;
export {};
