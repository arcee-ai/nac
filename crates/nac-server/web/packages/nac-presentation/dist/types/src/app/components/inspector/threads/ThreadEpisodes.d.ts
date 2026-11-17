import type { EpisodeSnapshot } from "../../../types/api";
/** The dispatches of one thread as collapsible tabs. */
export declare function Episodes({ episodes, running, className, }: {
    episodes: EpisodeSnapshot[];
    running: boolean;
    className?: string;
}): import("react").JSX.Element;
