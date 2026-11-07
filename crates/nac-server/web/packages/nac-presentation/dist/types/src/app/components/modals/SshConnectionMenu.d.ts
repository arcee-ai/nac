import type React from "react";
import type { SshConfigurationRecord } from "../../types/api";
export interface SshConnectionMenuProps {
    configurations: SshConfigurationRecord[];
    /** The saved profile in use, or null while drafting a new connection. */
    selectedConfigId: string | null;
    /** The OpenSSH alias the current draft started from, if any. */
    selectedAlias: string | null;
    isMobile: boolean;
    onCreateNew: () => void;
    onPickConfig: (configId: string) => void;
    onPickAlias: (alias: string) => void;
}
/**
 * The SSH connection picker: start a new connection, reuse a saved NAC
 * profile, or start from an OpenSSH alias the NAC server already knows. The
 * alias group reads the server machine's config, which is not necessarily the
 * machine this browser runs on, and says so.
 */
export declare function SshConnectionMenu({ configurations, selectedConfigId, selectedAlias, isMobile, onCreateNew, onPickConfig, onPickAlias, }: SshConnectionMenuProps): React.JSX.Element;
