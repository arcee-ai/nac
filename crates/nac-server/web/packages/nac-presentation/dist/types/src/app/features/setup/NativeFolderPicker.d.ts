import { type NativeDirectoryPort } from "./localFolder";
/** Keeps a shared overlay lifetime while AppKit owns the actual folder sheet.
 * Unmount/close/backend replacement cancels this invocation before late results. */
export declare function NativeFolderPicker({ port, initialPath, open, onSelect, onClose, }: {
    port: NativeDirectoryPort;
    initialPath: string;
    open: boolean;
    onSelect: (path: string) => void;
    onClose: () => void;
}): import("react").JSX.Element;
