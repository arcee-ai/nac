import { useQueries } from "@tanstack/react-query";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionPermissions, useTraditionalChildren } from "@/app/services/queries/direct";
import { queryKeys } from "@/app/services/queries/keys";

/** Read each broker independently; aggregation never changes request or grant ownership. */
export function usePermissionQueue(
  sessionId: string,
  enabled: boolean,
  requesterLabel?: string,
  {
    poll = true,
    includeChildren = true,
    parentSessionId,
  }: { poll?: boolean; includeChildren?: boolean; parentSessionId?: string } = {},
) {
  const { api } = useNativeRuntime();
  const parent = useSessionPermissions(sessionId, enabled, poll);
  const children = useTraditionalChildren(sessionId, enabled && includeChildren);
  const records = enabled && includeChildren ? (children.data ?? []) : [];
  const childPermissions = useQueries({
    queries: records.map((child) => ({
      queryKey: queryKeys.sessionPermissions(child.child_session_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.getPermissions(child.child_session_id, signal),
      refetchInterval: 1_000,
      staleTime: 0,
      retry: false,
    })),
  });
  const scopes = [
    { sessionId, parentSessionId, label: requesterLabel ?? "this session", query: parent },
    ...records.map((child, index) => ({
      sessionId: child.child_session_id,
      parentSessionId: child.parent_session_id,
      label: `child agent “${child.description}”`,
      query: childPermissions[index],
    })),
  ];
  // Keep cached requests visible during a failed refresh, but disable their
  // actions until the selected broker can be read again.
  const requests = scopes.flatMap((scope) =>
    (scope.query.data?.requests ?? []).map((request) => ({
      scope,
      request,
      key: JSON.stringify([scope.sessionId, request.id]),
    })),
  );
  const reviews = scopes
    .flatMap((scope) =>
      (scope.query.data?.reviews ?? []).map((review) => ({
        scope,
        review,
        key: JSON.stringify([scope.sessionId, review.id]),
        authorizable: (scope.query.data?.authorizable_review_ids ?? []).includes(review.id),
      })),
    )
    .sort((left, right) => right.review.created_at_epoch_ms - left.review.created_at_epoch_ms);
  return { parent, children, records, scopes, requests, reviews, includeChildren };
}
