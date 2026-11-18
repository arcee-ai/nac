import type { SshTarget } from "../../types/api";
/** A folder a project works in, on this computer or on an SSH host. */
export interface SourceFolder {
    path: string;
    ssh: SshTarget | null;
}
/**
 * Lists a project's folders and adds more. Each folder picks its own machine,
 * so one project can span this computer and SSH hosts.
 */
export declare function SourceFolders({ folders, onChange, defaultCwd, invalid, disabled, }: {
    folders: SourceFolder[];
    onChange: (folders: SourceFolder[]) => void;
    defaultCwd: string;
    invalid?: boolean;
    disabled?: boolean;
}): import("react").JSX.Element;
