import { useQueries } from "@tanstack/react-query";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionPermissions, useTraditionalChildren } from "@/app/services/queries/direct";
import { queryKeys } from "@/app/services/queries/keys";

/** Read each broker independently; aggregation never changes request or grant ownership. */
export function usePermissionQueue(sessionId: string, enabled: boolean, requesterLabel?: string) {
  const { api } = useNativeRuntime();
  const parent = useSessionPermissions(sessionId, enabled);
  const children = useTraditionalChildren(sessionId, enabled);
  const records = enabled ? (children.data ?? []) : [];
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
    { sessionId, label: requesterLabel ?? "this session", query: parent },
    ...records.map((child, index) => ({
      sessionId: child.child_session_id,
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
  return { parent, children, records, scopes, requests };
}
