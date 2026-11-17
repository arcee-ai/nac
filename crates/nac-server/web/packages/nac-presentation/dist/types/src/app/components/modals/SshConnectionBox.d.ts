import type { SshTarget } from "../../types/api";
export type SshConnectionBoxMode = "launch" | "settings" | "manage";
export interface SshConnectionBoxProps {
    mode: SshConnectionBoxMode;
    /** Launch/settings: the live connected target, or null when disconnected. */
    connection: SshTarget | null;
    onConnectionChange: (target: SshTarget | null, homePath?: string) => void;
    /**
     * Settings: seed the draft (and matching saved config, when one exists) from
     * the session's persisted SSH target while disconnected.
     */
    seedTarget?: SshTarget | null;
    /** Manage mode: controlled form fields. */
    name?: string;
    onNameChange?: (name: string) => void;
    host?: string;
    onHostChange?: (host: string) => void;
    port?: string;
    onPortChange?: (port: string) => void;
    identityFile?: string;
    onIdentityFileChange?: (path: string) => void;
    /** Manage mode: run a connectivity test without changing connection state. */
    onTest?: () => Promise<void>;
    testing?: boolean;
    /** When true, fields stay read-only (connected or parent disabled). */
    locked?: boolean;
    className?: string;
}
/**
 * Shared SSH form: pick or create a saved config, connect (and auto-persist a
 * new one), or — in manage mode — edit fields with a Test action.
 */
export declare function SshConnectionBox({ mode, connection, onConnectionChange, seedTarget, name: controlledName, onNameChange, host: controlledHost, onHostChange, port: controlledPort, onPortChange, identityFile: controlledKey, onIdentityFileChange, onTest, testing, locked, className, }: SshConnectionBoxProps): import("react").JSX.Element;
