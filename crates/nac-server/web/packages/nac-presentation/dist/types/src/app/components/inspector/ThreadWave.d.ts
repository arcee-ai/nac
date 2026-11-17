import { type InsightsOpenOptions } from "../../features/insights/useInsightsNavigation";
import type { TranscriptThread } from "../../lib/transcript";
export type SelectThread = (name: string, episodeKey: string, options?: InsightsOpenOptions) => void;
interface ThreadWaveProps {
    /** Topological levels from one assistant dispatch batch (DAG waves). */
    rows: TranscriptThread[][];
    /** Episode key of the row the panels are pointing at, if it is one of these. */
    selected: string | null;
    /** Without it the rows only show their threads. */
    onSelect?: SelectThread;
}
/**
 * One orchestrator dispatch batch as a small quiet card. Threads that run
 * concurrently share a level; a level that waits on the one before it follows
 * under a hairline marked "Then".
 */
export declare function ThreadWave({ rows, selected, onSelect }: ThreadWaveProps): import("react").JSX.Element;
export {};
