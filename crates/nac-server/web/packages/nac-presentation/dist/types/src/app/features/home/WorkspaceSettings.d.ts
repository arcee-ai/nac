import type { SandboxAvailability } from "../../types/api";
import { type SandboxOptions } from "./workspaceSandbox";
/**
 * The composer strip's "⋯" button: whether the session gets an isolated
 * checkout or a Podman sandbox. Each option preserves the ordinary composer
 * and exposes the launch details only when selected.
 */
export declare function WorkspaceSettings({ isolated, available, onIsolatedChange, gitRef, defaultRef, onRefChange, sandbox, disabled, }: {
    isolated: boolean;
    available: boolean;
    onIsolatedChange: (isolated: boolean) => void;
    gitRef: string;
    defaultRef: string | null;
    onRefChange: (ref: string) => void;
    sandbox?: {
        allowed: boolean;
        options: SandboxOptions | null;
        availability?: SandboxAvailability;
        checking: boolean;
        checkFailed: boolean;
        onChange: (options: SandboxOptions | null) => void;
        onRetry: () => void;
    };
    disabled?: boolean;
}): import("react").JSX.Element;
