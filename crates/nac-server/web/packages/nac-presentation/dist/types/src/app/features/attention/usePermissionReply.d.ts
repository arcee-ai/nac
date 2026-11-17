import type { PermissionQueueEntry } from "../permissions/usePermissionQueue";
import type { PermissionReply } from "../../types/api";
export interface PermissionReplyState {
    /** Answers one request in its own broker scope. Resolves whether the server took it. */
    reply: (entry: PermissionQueueEntry, choice: PermissionReply) => Promise<boolean>;
    /** The request and choice in flight, if any; one reply at a time. */
    replying: {
        key: string;
        choice: PermissionReply;
    } | null;
}
/**
 * The one way a pending request is answered, shared by the attention card and
 * the permission sheet. A reply always goes to the broker that owns the
 * request — never the visible session — and stays off while that broker
 * cannot be read, so a cached request is never answered blind.
 */
export declare function usePermissionReply(): PermissionReplyState;
