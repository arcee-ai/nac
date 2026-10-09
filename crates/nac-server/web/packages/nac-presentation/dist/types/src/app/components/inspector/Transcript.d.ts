import { type ErrorNotice } from "../../hooks/useErrorNotice";
import { type SessionPanel } from "../../lib/routes";
import type { RunFailure, SessionGoalRecord, SessionSnapshotResponse } from "../../types/api";
interface TranscriptProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    /** Which side-panel tab is currently open. */
    panel: SessionPanel;
    /** Brings the matching side panel forward when the chat points at a row. */
    onFocusPanel: (panel: SessionPanel) => void;
    /**
     * The failure the chat reports — a broken config, an unreadable snapshot, or
     * whatever the provider refused the run over — already put into words and
     * paired with whatever can be done about it.
     */
    errorNotice?: ErrorNotice | null;
}
export declare function TranscriptRecoveryNotice({ warning }: {
    warning?: string | null;
}): import("react").JSX.Element | null;
export declare function RunFailureNotice({ failure, goal, action, }: {
    failure: RunFailure;
    goal?: SessionGoalRecord | null;
    action?: {
        label: string;
        onClick: () => void;
    };
}): import("react").JSX.Element;
/**
 * Read-only transcript from the canonical snapshot plus a live typing indicator
 * fed by the SSE runtime store. Follows new content unless the user scrolls up.
 */
export declare function Transcript({ sessionId, snapshot, panel, onFocusPanel, errorNotice, }: TranscriptProps): import("react").JSX.Element;
export {};
