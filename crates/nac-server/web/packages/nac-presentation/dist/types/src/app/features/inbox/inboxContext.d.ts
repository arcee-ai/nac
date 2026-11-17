import type { FleetAttentionStatus } from "../../services/queries";
import type { FleetAttentionSession } from "../../types/api";
import type { InboxModel, InboxRow, InboxTarget } from "./inboxModel";
export interface InboxContextValue {
    model: InboxModel;
    /** The attention feed itself: "unavailable" means nothing below can be trusted. */
    status: FleetAttentionStatus;
    /** Raw fleet facts per session, for read marks and the status ladder. */
    attention: ReadonlyMap<string, FleetAttentionSession>;
    lastOutcomeRun: (sessionId: string) => string | null;
    open: (row: InboxRow) => void;
    openNext: () => void;
    markAllRead: () => void;
    markRead: (sessionId: string, runId: string) => void;
}
export declare const EMPTY_INBOX: InboxModel;
export declare const InboxContext: import("react").Context<InboxContextValue | null>;
/** The Inbox; outside the provider (isolated component tests) it is honestly unavailable. */
export declare function useInbox(): InboxContextValue;
/** The session route for a row, at the exact request when there is one. */
export declare function inboxHref(target: InboxTarget): string;
