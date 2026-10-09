import { type UserTerminalConnection } from "./userTerminalConnection.js";
export declare class TerminalInputNotSentError extends Error {
    readonly cause: unknown;
    constructor(message: string, cause?: unknown);
}
/** Ordered keyboard/paste pump: one active write and one coalescing pending 16 KiB buffer.
 * Failed active delivery discards pending bytes with explicit not-sent receipts.
 * It never retries bytes or silently resumes after uncertain delivery.
 */
export declare class UserTerminalInputPump {
    private readonly connection;
    private readonly abort;
    private readonly signal;
    private readonly cancelListener;
    private pending;
    private active;
    private failed;
    private disposed;
    constructor(connection: Pick<UserTerminalConnection, "input" | "acknowledgeInputUncertainty">, signal?: AbortSignal);
    get pendingBytes(): number;
    get hasActiveInput(): boolean;
    get needsAcknowledgement(): boolean;
    send(bytes: Uint8Array): Promise<void>;
    private rejectPending;
    private deliver;
    /** Enables only fresh input after an explicit consumer decision; discarded bytes stay discarded. */
    acknowledgeFailure(): void;
    dispose(): void;
}
