import { SelectionReviewController } from "./reviewController";
/** Origin-scoped invalidation receives no original draft or request variables. */
export declare function useSelectionReview(sessionId: string): {
    controller: SelectionReviewController;
    state: import("./reviewController").ReviewSnapshot;
};
