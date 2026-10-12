import { type FilesPanelLink } from "./SnapshotBadge";
import { type ModelTurn } from "../../lib/transcript";
import type { SessionForkLink, WorkspaceRevision } from "../../types/api";
interface ModelMessageProps {
    turn: ModelTurn;
    model: string;
    /** Draws the spinner ring while this turn is the one still producing output. */
    active: boolean;
    /**
     * What the run is doing right now. Only the active turn is given it, so the
     * finished ones are not re-rendered every time the line changes.
     */
    activity?: string;
    /** Stretches the last bubble so stick-to-bottom lands below the fold. */
    isLast?: boolean;
    /** Episode key of the thread card the panels are pointing at, if any. */
    selectedThreadEpisode: string | null;
    selectedWorkset: string | null;
    onSelectThread: (name: string, episodeKey: string) => void;
    onSelectWorkset: (id: string) => void;
    /**
     * Snapshot index of the user prompt this model turn answers. Regenerate and
     * revert address that prompt — same endpoints as the user bubble above.
     */
    userMessageIndex?: number;
    /** Prompt text handed to revert so the confirm modal can quote it. */
    userText?: string;
    /**
     * Answer the preceding prompt again. Only the model turn that answered the
     * newest user message gets this — older turns keep revert + copy only, and a
     * newest prompt nothing answered keeps the action on its own bubble.
     */
    onRefresh?: ((messageIndex: number) => void) | null;
    /** Restore the session to the snapshot at the preceding prompt. */
    onRevert?: ((messageIndex: number, text: string) => void) | null;
    /** Clone this turn into a new chat. */
    onFork?: ((messageIndex: number) => void) | null;
    /** Forks created from this model turn. */
    forks?: SessionForkLink[];
    onOpenFork?: (sessionId: string) => void;
    onDismissFork?: (forkId: string) => void;
    /** Disable destructive / network actions while a run is in flight. */
    actionsDisabled?: boolean;
    /** Parent-owned delegated transcripts expose copy but no mutation affordances. */
    readOnly?: boolean;
    /**
     * The revision captured for the run behind this turn, when that run changed
     * anything. Absent on a turn whose run is still going, was cancelled, or
     * touched no files.
     */
    snapshotRevision?: WorkspaceRevision | null;
    /** Where a click on the snapshot or one of its files should land. */
    filesPanel?: FilesPanelLink | null;
}
/**
 * Everything the orchestrator did for one prompt, in the order it happened:
 * reasoning, prose, the worksets it defined and the waves of threads it ran.
 */
export declare const ModelMessage: import("react").MemoExoticComponent<({ turn, model, active, activity, isLast, selectedThreadEpisode, selectedWorkset, onSelectThread, onSelectWorkset, userMessageIndex, userText, onRefresh, onRevert, onFork, forks, onOpenFork, onDismissFork, actionsDisabled, readOnly, snapshotRevision, filesPanel, }: ModelMessageProps) => import("react").JSX.Element>;
export {};
