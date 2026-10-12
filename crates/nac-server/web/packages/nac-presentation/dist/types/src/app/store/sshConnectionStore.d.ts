import type { SshTarget } from "../types/api";
export type SshConnectionStatus = "unknown" | "connected" | "disconnected";
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createSshConnectionStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    sshTargetKey: (target: SshTarget) => string;
    markSshConnected: (target: SshTarget) => void;
    markSshDisconnected: (target: SshTarget) => void;
    useSshConnectionStatus: (target: SshTarget | null) => SshConnectionStatus;
    sshTargetFromSummary: (summary: {
        ssh_host: string | null;
        ssh_port?: number | null;
        ssh_identity_file?: string | null;
    } | null | undefined) => SshTarget | null;
};
export declare const release: () => void, sshTargetKey: (target: SshTarget) => string, markSshConnected: (target: SshTarget) => void, markSshDisconnected: (target: SshTarget) => void, useSshConnectionStatus: (target: SshTarget | null) => SshConnectionStatus, sshTargetFromSummary: (summary: {
    ssh_host: string | null;
    ssh_port?: number | null;
    ssh_identity_file?: string | null;
} | null | undefined) => SshTarget | null;
