import type { UserTerminalApi } from "./userTerminalApi.js";
import type { UserTerminalFrameResponse } from "./types.js";
export declare const NAC_TERMINAL_PROTOCOL_VERSION: 1;
export declare class TerminalProtocolError extends Error {
    constructor(message: string);
}
export declare class TerminalInputUncertainError extends Error {
    readonly cause: unknown;
    constructor(cause: unknown);
}
export interface UserTerminalRenderer {
    /** Resolve only after the terminal parser has processed these literal bytes. */
    write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
    /** Resolve after clearing parser/screen state; never silently splice retained history. */
    reset(reason: "attach" | "reconnect" | "gap", signal: AbortSignal): Promise<void>;
}
export interface UserTerminalConnectionOptions {
    pageLimit?: number;
    waitMs?: number;
}
/** One observer, one outstanding frame, and no queued input or automatic mutation retries. */
export declare class UserTerminalConnection {
    private readonly api;
    readonly sessionId: string;
    readonly terminalId: string;
    private readonly renderer;
    private readonly pageLimit;
    private readonly waitMs;
    private lifetime;
    private observer;
    private acknowledgement;
    private expectedOffset;
    private reading;
    private attaching;
    private needsReset;
    private sendingInput;
    private inputUncertain;
    constructor(api: UserTerminalApi, sessionId: string, terminalId: string, renderer: UserTerminalRenderer, options?: UserTerminalConnectionOptions);
    get observerId(): string | undefined;
    get isInputUncertain(): boolean;
    private signal;
    private status;
    attach(signal?: AbortSignal, reason?: "attach" | "reconnect"): Promise<{
        alive: boolean;
        cols: number;
        exit_code?: number | null;
        output_complete: boolean;
        output_error?: string | null;
        protocol_version: number;
        rows: number;
        terminal_id: string;
    }>;
    /** Expired observers require explicit reconnect and a renderer reset before replay. */
    reconnect(signal?: AbortSignal): Promise<{
        alive: boolean;
        cols: number;
        exit_code?: number | null;
        output_complete: boolean;
        output_error?: string | null;
        protocol_version: number;
        rows: number;
        terminal_id: string;
    }>;
    private validate;
    readNext(signal?: AbortSignal): Promise<UserTerminalFrameResponse>;
    /** Runs until output EOF and final renderer ACK; failures stop without retry.
     * The returned status may still be alive: consumers continue separate status polling
     * until process exit rather than treating closed output as shell termination.
     */
    run(signal?: AbortSignal, onFrame?: (frame: UserTerminalFrameResponse) => void): Promise<{
        alive: boolean;
        cols: number;
        exit_code?: number | null;
        output_complete: boolean;
        output_error?: string | null;
        protocol_version: number;
        rows: number;
        terminal_id: string;
    }>;
    /** Detaches observation only. Closing the process uses the separate terminateTerminal API. */
    detach(signal?: AbortSignal): Promise<void>;
    input(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
    /** Explicit consumer acknowledgement enables fresh input; previously sent bytes are never replayed. */
    acknowledgeInputUncertainty(): void;
    resize(cols: number, rows: number, signal?: AbortSignal): Promise<void>;
}
