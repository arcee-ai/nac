import { type RefObject } from "react";
import type { SessionSnapshotResponse } from "../../types/api";
interface Props {
    sessionId: string;
    messages: SessionSnapshotResponse["messages"];
    /** Raw snapshot index of `messages[0]`. */
    windowStart: number;
    /** The transcript region whose completed replies can be selected. */
    containerRef: RefObject<HTMLElement | null>;
}
/**
 * Ask about selected reply text: the affordance beside a selection, the
 * review, and the answer pane. Independent of the chat's run, composer and
 * inbox; it only ever talks to the selection-question routes.
 */
export declare function SelectionQuestions({ sessionId, messages, windowStart, containerRef }: Props): import("react").JSX.Element;
export {};
