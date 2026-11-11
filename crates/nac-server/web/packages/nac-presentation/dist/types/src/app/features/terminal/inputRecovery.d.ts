export interface TerminalInputRecoveryLease {
    current: boolean;
    readonly available: boolean;
    /** Deliberately non-recording observation, not exhausted live-input capacity. */
    readonly observationOnly: boolean;
    subscribe(listener: () => void): () => void;
    acknowledge(): boolean;
    release(): void;
}
/** Process-local delivery facts only: no input bytes, retries or authority. */
export declare class TerminalInputRecovery {
    private readonly limit;
    private readonly requireAcknowledgement;
    private readonly entries;
    private closed;
    constructor(limit?: number, requireAcknowledgement?: boolean);
    acquire(sessionId: string, executionId: string, observationOnly?: boolean): TerminalInputRecoveryLease;
    close(): void;
}
export declare function recoveryForRuntime(runtime: object & {
    terminalInputRecovery?: TerminalInputRecovery;
}): TerminalInputRecovery;
