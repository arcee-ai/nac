import type { NacClient } from "./nacClient.js";
import type { TerminalSelectionSubmissionRequest, TerminalSelectionPreviewRequest, OpenUserTerminalRequest, AttachUserTerminalRequest, PullUserTerminalRequest, UserTerminalInputRequest, ResizeUserTerminalRequest } from "./types.js";
/** Uses exactly the consumer's immutable endpoint, credentials and request lifetime. */
export declare function createUserTerminalApi(client: NacClient): {
    /** Explicit durable intent. Freeze admission_id and manually reconcile it
     * after uncertainty; this method never retries or creates a new identity. */
    submitUserTerminalSelection: (session: string, terminal: string, body: TerminalSelectionSubmissionRequest, signal?: AbortSignal) => Promise<{
        accepted_intent: import("./openapi.generated.js").components["schemas"]["TerminalSelectionIntent"];
        admission_id: string;
        current_delivery: import("./openapi.generated.js").components["schemas"]["InboxDelivery"];
        current_target_run_id?: string | null;
        delivered_run_id?: string | null;
        inbox_id: string;
        protocol_version: number;
        replayed: boolean;
        status: import("./openapi.generated.js").components["schemas"]["InboxStatus"];
        version: number;
    }>;
    /** Preview only. Keep the frozen original beside this canonical text locally.
     * Submission normalizes the original again and compares the exact
     * expected preview, rather than assuming masking is idempotent or trusting
     * a client sanitization flag. This operation never sends agent input.
     */
    previewUserTerminalSelection: (session: string, terminal: string, body: TerminalSelectionPreviewRequest, signal?: AbortSignal) => Promise<{
        capture_id: string;
        client_capture_time_ms?: string | null;
        controls_removed: number;
        input_scalars: number;
        input_utf8_bytes: number;
        line_endings_normalized: number;
        max_scalars: number;
        max_utf8_bytes: number;
        owner_instance_id: string;
        previewed_at_ms: string;
        protocol_version: number;
        source_kind: import("./openapi.generated.js").components["schemas"]["TerminalSelectionSourceKind"];
        source_session_id: string;
        terminal_id: string;
        text: string;
        text_scalars: number;
        text_utf8_bytes: number;
        truncated: boolean;
        user_text?: string | null;
    }>;
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
