import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries/keys";

/** Invalidate helpers shared by every mutation below. */
export function useQueryInvalidators() {
  const client = useQueryClient();
  return {
    sessions: () => client.invalidateQueries({ queryKey: queryKeys.sessionsAll }),
    projects: () => client.invalidateQueries({ queryKey: queryKeys.projects }),
    session: (id: string) =>
      client.invalidateQueries({
        queryKey: queryKeys.sessionSnapshot(id),
        exact: true,
      }),
    sessionRoot: (id: string) => client.invalidateQueries({ queryKey: queryKeys.sessionRoot(id) }),
  };
}
