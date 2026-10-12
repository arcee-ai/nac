import type { ReviewSnapshot, SelectionReviewController } from "./reviewController";
export interface ReviewAvailability {
    readonly mode: "idle" | "busy" | "unknown";
    readonly runId?: string;
    readonly sourceAlive?: boolean;
    readonly sourceUnavailable?: boolean;
}
interface Props {
    readonly state: ReviewSnapshot;
    readonly controller: SelectionReviewController;
    readonly availability: ReviewAvailability;
}
/** Displays only server-normalized reviewed evidence; no transport or storage. */
export declare function SelectionReview({ state, controller, availability }: Props): import("react").JSX.Element;
export {};
