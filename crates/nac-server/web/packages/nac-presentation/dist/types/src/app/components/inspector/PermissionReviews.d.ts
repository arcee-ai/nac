import type { PermissionReview } from "../../types/api";
/** Availability reflects the last retained review, never a continuing health guarantee. */
export declare function PermissionReviewStatus({ reviews }: {
    reviews: PermissionReview[];
}): import("react").JSX.Element;
export declare function PermissionReviewRow({ review, authorizable, authorizing, disabled, disabledReason, onAuthorize, }: {
    review: PermissionReview;
    authorizable: boolean;
    authorizing: boolean;
    disabled: boolean;
    disabledReason?: string;
    onAuthorize: () => void;
}): import("react").JSX.Element;
