import { type ThreadDetailView } from "./ThreadViewControls";
import { type ThreadLogLine } from "../../../lib/threadLog";
import type { AgentEvent, EpisodeSnapshot, ThreadSnapshot } from "../../../types/api";
export interface ThreadDetailProps {
    thread: ThreadSnapshot;
    /** What this thread was asked to do, live for the dispatch in flight. */
    action: string;
    episodes: EpisodeSnapshot[];
    /** Commands the store has persisted for this thread. */
    events: AgentEvent[] | undefined;
    /** The same commands as the stream reported them, plus whatever came after. */
    liveLog: ThreadLogLine[];
    running: boolean;
    hasOlder: boolean;
    loadingOlder: boolean;
    loadingInitial: boolean;
    historyError: string | null;
    onLoadOlder: () => Promise<void>;
    onRetry: () => Promise<void>;
    view: ThreadDetailView;
    canSteer: boolean;
    onSteer: () => void;
    onViewChange: (view: ThreadDetailView) => void;
}
/**
 * One thread's command log or its episodes. Key it by session and thread: the
 * log's scroll anchoring lives in refs that must not carry over to another
 * thread.
 */
export declare function ThreadDetail({ thread, action, episodes, events, liveLog, running, hasOlder, loadingOlder, loadingInitial, historyError, onLoadOlder, onRetry, view, canSteer, onSteer, onViewChange, }: ThreadDetailProps): import("react").JSX.Element;
