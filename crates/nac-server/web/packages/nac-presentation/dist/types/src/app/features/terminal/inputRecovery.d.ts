export interface TerminalInputRecoveryLease {
    current: boolean;
    readonly available: boolean;
    subscribe(listener: () => void): () => void;
    acknowledge(): boolean;
    release(): void;
}
/** Process-local delivery facts only: no input bytes, retries or authority. */
export declare class TerminalInputRecovery {
    private readonly limit;
    private readonly entries;
    private closed;
    constructor(limit?: number);
    acquire(sessionId: string, executionId: string): TerminalInputRecoveryLease;
    close(): void;
}
export declare function recoveryForRuntime(runtime: object & {
    terminalInputRecovery?: TerminalInputRecovery;
}): TerminalInputRecovery;
