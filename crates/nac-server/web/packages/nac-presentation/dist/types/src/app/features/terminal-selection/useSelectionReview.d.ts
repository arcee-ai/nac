import { SelectionReviewController } from "./reviewController.js";
/** Origin-scoped invalidation receives no original draft or request variables. */
export declare function useSelectionReview(sessionId: string): {
    controller: SelectionReviewController;
    state: import("./reviewController.js").ReviewSnapshot;
};
