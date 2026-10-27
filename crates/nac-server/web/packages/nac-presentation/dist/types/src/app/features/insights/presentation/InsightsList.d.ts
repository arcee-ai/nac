import { type ReactNode } from "react";
import type { InsightsEmptyCopy, InsightTurnSection } from "../model/types";
import { type InsightsRowController } from "./InsightsTurnSection";
export declare function InsightsList({ sections, pendingPrompt, emptyCopy, focusNonce, controller, footer, }: {
    sections: readonly InsightTurnSection[];
    /** The prompt a streamed turn answers before the snapshot shows it. */
    pendingPrompt: string;
    emptyCopy: InsightsEmptyCopy;
    /** Bumps on every pick; the picked row is scrolled into view. */
    focusNonce: number;
    controller: InsightsRowController;
    /** After the oldest section, and under the empty copy too. */
    footer?: ReactNode;
}): import("react").JSX.Element;
