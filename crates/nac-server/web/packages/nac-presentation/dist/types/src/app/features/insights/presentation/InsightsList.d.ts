import { type ReactNode } from "react";
import type { InsightsEmptyCopy, InsightTurnSection } from "../model/types";
import { type InsightsRowController } from "./InsightsTurnSection";
export declare const InsightsList: import("react").MemoExoticComponent<({ sessionId, sections, pendingPrompt, emptyCopy, focusNonce, controller, footer, }: {
    sessionId: string;
    sections: readonly InsightTurnSection[];
    /** The prompt a streamed turn answers before the snapshot shows it. */
    pendingPrompt: string;
    emptyCopy: InsightsEmptyCopy;
    /** Bumps on every pick; the shown row is scrolled into view. */
    focusNonce: number;
    controller: InsightsRowController;
    /** After the oldest section, and under the empty copy too. */
    footer?: ReactNode;
}) => import("react").JSX.Element>;
