import type { NacClient } from "./nacClient.js";
import type { OpenUserTerminalRequest, AttachUserTerminalRequest, PullUserTerminalRequest, UserTerminalInputRequest, ResizeUserTerminalRequest } from "./types.js";
/** Uses exactly the consumer's immutable endpoint, credentials and request lifetime. */
export declare function createUserTerminalApi(client: NacClient): {
    openUserTerminal: (session: string, body: OpenUserTerminalRequest, signal?: AbortSignal) => Promise<{
        alive: boolean;
        cols: number;
        exit_code?: number | null;
        output_complete: boolean;
        output_error?: string | null;
        protocol_version: number;
        rows: number;
        terminal_id: string;
    }>;
    listUserTerminals: (session: string, signal?: AbortSignal) => Promise<{
        protocol_version: number;
        terminals: import("./openapi.generated.js").components["schemas"]["UserTerminalResponse"][];
    }>;
    getUserTerminal: (session: string, terminal: string, signal?: AbortSignal) => Promise<{
        alive: boolean;
        cols: number;
        exit_code?: number | null;
        output_complete: boolean;
        output_error?: string | null;
        protocol_version: number;
        rows: number;
        terminal_id: string;
    }>;
    attachUserTerminal: (session: string, terminal: string, body: AttachUserTerminalRequest, signal?: AbortSignal) => Promise<{
        idle_expiry_ms: number;
        observer_id: string;
        protocol_version: number;
        terminal: import("./openapi.generated.js").components["schemas"]["UserTerminalResponse"];
    }>;
    pullUserTerminal: (session: string, terminal: string, observer: string, body: PullUserTerminalRequest, signal?: AbortSignal) => Promise<{
        bytes: number[];
        caught_up: boolean;
        gap: boolean;
        next_offset: string;
        observer_id: string;
        offset: string;
        protocol_version: number;
        requires_ack: boolean;
        retained_end: string;
        retained_start: string;
        terminal: import("./openapi.generated.js").components["schemas"]["UserTerminalResponse"];
    }>;
    detachUserTerminal: (session: string, terminal: string, observer: string, signal?: AbortSignal) => Promise<void>;
    inputUserTerminal: (session: string, terminal: string, body: UserTerminalInputRequest, signal?: AbortSignal) => Promise<void>;
    resizeUserTerminal: (session: string, terminal: string, body: ResizeUserTerminalRequest, signal?: AbortSignal) => Promise<void>;
};
export type UserTerminalApi = ReturnType<typeof createUserTerminalApi>;
