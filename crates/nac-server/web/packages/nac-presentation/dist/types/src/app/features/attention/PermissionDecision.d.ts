import { type ReactNode } from "react";
import type { PermissionQueueEntry } from "../permissions/usePermissionQueue";
import type { PermissionReply } from "../../types/api";
import type { PermissionReplyState } from "./usePermissionReply";
interface PermissionDecisionProps {
    entry: PermissionQueueEntry;
    /** Who asked, as the queue labels it ("this session", "child agent “…”"). */
    requester: string;
    replying: PermissionReplyState["replying"];
    onReply: (choice: PermissionReply) => void;
    /** Draw ⏎ and D beside the choices they press. */
    showKeys?: boolean;
    /** 44px choices for a touch screen. */
    touch?: boolean;
    /** Extra explanation at the head of the requested access. */
    context?: ReactNode;
    className?: string;
}
/**
 * What one request would authorize, and the three ways to answer it. Every
 * resource the broker attached is shown in full — this is what is being
 * approved — and "Always allow" names the exact rules it would store.
 */
export declare function PermissionDecision({ entry, requester, replying, onReply, showKeys, touch, context, className, }: PermissionDecisionProps): import("react").JSX.Element;
export {};
