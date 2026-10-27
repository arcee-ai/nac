import { type ErrorNotice } from "../../hooks/useErrorNotice";
import { type SessionPanel } from "../../lib/routes";
import type { SessionSnapshotResponse } from "../../types/api";
interface TranscriptProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    /** Which side-panel tab is on screen; null while the side box is hidden. */
    panel: SessionPanel | null;
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
/**
 * Read-only transcript from the canonical snapshot plus a live typing indicator
 * fed by the SSE runtime store. Follows new content unless the user scrolls up.
 */
export declare function Transcript({ sessionId, snapshot, panel, onFocusPanel, errorNotice, }: TranscriptProps): import("react").JSX.Element;
export {};
