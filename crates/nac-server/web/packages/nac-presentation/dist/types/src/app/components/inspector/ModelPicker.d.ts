import type { SessionMetadata } from "../../types/api";
/**
 * The session's current model and reasoning, directly switchable beside the
 * composer from one catalog spanning every connected provider. Cross-provider
 * changes send the complete routing tuple in one revisioned server mutation.
 */
export declare function ModelPicker({ sessionId, metadata, label, disabled, }: {
    sessionId: string;
    metadata: SessionMetadata | null;
    /** What the status bar shows while the snapshot carries no metadata yet. */
    label: string;
    /** A run is in flight, and the server refuses a config change until it ends. */
    disabled: boolean;
}): import("react").JSX.Element;
