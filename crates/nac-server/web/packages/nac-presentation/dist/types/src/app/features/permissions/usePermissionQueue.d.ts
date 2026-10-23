/** Read each broker independently; aggregation never changes request or grant ownership. */
export declare function usePermissionQueue(sessionId: string, enabled: boolean, requesterLabel?: string, { poll, includeChildren, parentSessionId, }?: {
    poll?: boolean;
    includeChildren?: boolean;
    parentSessionId?: string;
}): {
    parent: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        approval_mode: import("../../types/openapi.generated").components["schemas"]["PermissionApprovalMode"];
        authorizable_review_ids?: string[];
        grants: import("../../types/openapi.generated").components["schemas"]["PermissionGrantRecord"][];
        requests: import("../../types/openapi.generated").components["schemas"]["PermissionRequest"][];
        reviews?: import("../../types/openapi.generated").components["schemas"]["PermissionReview"][];
    }>, Error>;
    children: import("@tanstack/react-query").UseQueryResult<NoInfer<{
        change_summary: string | null;
        child_session_id: string;
        completion_inbox_id: number | null;
        created_at: string;
        description: string;
        execution_mode: import("../../types/openapi.generated").components["schemas"]["TraditionalChildExecutionMode"] | null;
        failure: string | null;
        generation: number;
        nesting_depth: number;
        parent_session_id: string;
        profile: string;
        report: string | null;
        root_session_id: string;
        run_id: string | null;
        status: import("../../types/openapi.generated").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        verification_summary: string | null;
        version: number;
    }[]>, Error>;
    records: {
        change_summary: string | null;
        child_session_id: string;
        completion_inbox_id: number | null;
        created_at: string;
        description: string;
        execution_mode: import("../../types/openapi.generated").components["schemas"]["TraditionalChildExecutionMode"] | null;
        failure: string | null;
        generation: number;
        nesting_depth: number;
        parent_session_id: string;
        profile: string;
        report: string | null;
        root_session_id: string;
        run_id: string | null;
        status: import("../../types/openapi.generated").components["schemas"]["TraditionalChildStatus"];
        updated_at: string;
        verification_summary: string | null;
        version: number;
    }[];
    scopes: {
        sessionId: string;
        parentSessionId: string | undefined;
        label: string;
        query: import("@tanstack/react-query").UseQueryResult<NoInfer<{
            approval_mode: import("../../types/openapi.generated").components["schemas"]["PermissionApprovalMode"];
            authorizable_review_ids?: string[];
            grants: import("../../types/openapi.generated").components["schemas"]["PermissionGrantRecord"][];
            requests: import("../../types/openapi.generated").components["schemas"]["PermissionRequest"][];
            reviews?: import("../../types/openapi.generated").components["schemas"]["PermissionReview"][];
        }>, Error>;
    }[];
    requests: {
        scope: {
            sessionId: string;
            parentSessionId: string | undefined;
            label: string;
            query: import("@tanstack/react-query").UseQueryResult<NoInfer<{
                approval_mode: import("../../types/openapi.generated").components["schemas"]["PermissionApprovalMode"];
                authorizable_review_ids?: string[];
                grants: import("../../types/openapi.generated").components["schemas"]["PermissionGrantRecord"][];
                requests: import("../../types/openapi.generated").components["schemas"]["PermissionRequest"][];
                reviews?: import("../../types/openapi.generated").components["schemas"]["PermissionReview"][];
            }>, Error>;
        };
        request: {
            call_id?: string | null;
            created_at_epoch_ms: number;
            id: string;
            resources: import("../../types/openapi.generated").components["schemas"]["PermissionRequestResource"][];
            session_id: string;
            tool: string;
        };
        key: string;
    }[];
    reviews: {
        scope: {
            sessionId: string;
            parentSessionId: string | undefined;
            label: string;
            query: import("@tanstack/react-query").UseQueryResult<NoInfer<{
                approval_mode: import("../../types/openapi.generated").components["schemas"]["PermissionApprovalMode"];
                authorizable_review_ids?: string[];
                grants: import("../../types/openapi.generated").components["schemas"]["PermissionGrantRecord"][];
                requests: import("../../types/openapi.generated").components["schemas"]["PermissionRequest"][];
                reviews?: import("../../types/openapi.generated").components["schemas"]["PermissionReview"][];
            }>, Error>;
        };
        review: {
            backend: string;
            call_id?: string | null;
            category?: import("../../types/openapi.generated").components["schemas"]["ReviewCategory"] | null;
            code?: import("../../types/openapi.generated").components["schemas"]["PermissionReviewCode"] | null;
            created_at_epoch_ms: number;
            duration_ms?: number | null;
            failure_reason?: import("../../types/openapi.generated").components["schemas"]["PermissionReviewFailureReason"] | null;
            id: string;
            outcome?: import("../../types/openapi.generated").components["schemas"]["PermissionReviewOutcome"] | null;
            resources: import("../../types/openapi.generated").components["schemas"]["ReviewResource"][];
            reviewer: string;
            session_id: string;
            tool: string;
            user_authorized_retry: boolean;
        };
        key: string;
        authorizable: boolean;
    }[];
    includeChildren: boolean;
};
