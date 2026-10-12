import { type BrowseKind } from "../../services/queries";
import type { SshTarget } from "../../types/api";
/**
 * Picks a path from the machine running the server, or from an SSH host when
 * `ssh` names one.
 *
 * Browsers never hand a web page an absolute path — `<input type="file">` and
 * the File System Access API both withhold it — so the filesystem is browsed
 * through the API instead of through the operating system's dialog. A remote
 * host is browsed the same way for the same reason, one directory per request.
 */
interface PathPickerProps {
    kind: BrowseKind;
    initialPath: string;
    /** Browses this host instead of the local filesystem. */
    ssh?: SshTarget | null;
    /** Overrides the title derived from `kind`. */
    title?: string;
    /** Starts with dot-prefixed entries listed, for paths that live in one. */
    showHidden?: boolean;
    /** Offers a way back to whatever the caller treats as no explicit path. */
    clearLabel?: string;
    onClear?: () => void;
    onClose: () => void;
    onSelect: (path: string) => void;
}
export declare function PathPickerModal({ open, ssh, ...props }: PathPickerProps & {
    open: boolean;
}): import("react").JSX.Element | null;
export {};
