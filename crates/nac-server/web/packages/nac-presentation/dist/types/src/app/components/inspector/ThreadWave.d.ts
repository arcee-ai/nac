import type { TranscriptThread } from "../../lib/transcript";
interface ThreadWaveProps {
    /** Topological levels from one assistant dispatch batch (DAG waves). */
    rows: TranscriptThread[][];
    /** Episode key of the card the panels are pointing at, if it is one of these. */
    selected: string | null;
    onSelect: (name: string, episodeKey: string) => void;
}
/**
 * One orchestrator dispatch batch, possibly split into stacked DAG levels.
 * Independent threads share a row; dependents wait in the next row as pending.
 */
export declare function ThreadWave({ rows, selected, onSelect }: ThreadWaveProps): import("react").JSX.Element;
export {};
