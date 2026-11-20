import type { PointerEvent } from "react";
import type { SessionBehavior, SessionMetadata } from "../../../types/api";
import { type ComposerMenuProps } from "./ComposerMenu";
export type SubmitMode = "send" | "steer" | "stop" | "stopping";
export interface ComposerSubmit {
    mode: SubmitMode;
    /** Whether the field holds something that can go out now. */
    canSend: boolean;
    /** A direct run takes the text as the next turn instead of a steer. */
    onQueue: (() => void) | null;
    onStop: () => void;
    /** Keeps an open suggestion's focus through the press. */
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}
export interface ComposerFooterProps {
    sessionId: string;
    behavior: SessionBehavior | null;
    compact: boolean;
    menu: Omit<ComposerMenuProps, "sessionId" | "compact">;
    metadata: SessionMetadata | null;
    modelLabel: string;
    modelDisabled: boolean;
    ssh: {
        connected: boolean;
        onReconnect: () => void;
    } | null;
    permissionSheet: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        focusKey: string | null;
    };
    contextTokens: number | null;
    onCompact: (() => void) | null;
    compacting: boolean;
    submit: ComposerSubmit;
}
/**
 * The one row under the message: `+`, the model chip, the permission chip,
 * and Send in its context ring. Nothing else lives here; everything that asks
 * for a decision rides in the attention card above the composer instead.
 */
export declare function ComposerFooter({ sessionId, behavior, compact, menu, metadata, modelLabel, modelDisabled, ssh, permissionSheet, contextTokens, onCompact, compacting, submit, }: ComposerFooterProps): import("react").JSX.Element;
