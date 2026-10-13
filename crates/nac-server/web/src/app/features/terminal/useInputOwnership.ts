import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type {
  ExecutionStatus,
  InputControlStatus,
} from "../../../../packages/nac-client/src/index";

export const inputOwnershipKey = (session: string, id: string) =>
  ["session", session, "execution", id, "input-control"] as const;

export function mayOfferInputControl(source: ExecutionStatus | undefined, readonly: boolean) {
  return (
    !readonly &&
    source?.representation === "pty" &&
    source.backend === "local" &&
    (source.origin === "human" || (source.origin === "agent" && source.retained))
  );
}

function newer(previous: InputControlStatus | undefined, next: InputControlStatus) {
  return previous && BigInt(previous.revision) > BigInt(next.revision) ? previous : next;
}

/** Current control is independent of immutable output frames and provenance. */
export function useInputOwnership(session: string, source: ExecutionStatus, readonly: boolean) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const key = inputOwnershipKey(session, source.id);
  const offered = mayOfferInputControl(source, readonly);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.getTerminalInputControl(session, source.id, signal),
    enabled: offered,
    retry: false,
    refetchInterval: offered ? 1000 : false,
    structuralSharing: (previous, next) =>
      newer(previous as InputControlStatus | undefined, next as InputControlStatus),
  });
  const transition = useMutation({
    mutationFn: async ({
      controller,
      acknowledge = false,
    }: {
      controller: "human" | "agent";
      acknowledge?: boolean;
    }) => {
      if (!offered || query.isError || !query.data)
        throw new Error("Current input ownership is unavailable. Refresh before changing control.");
      const expected = query.data.revision;
      await client.cancelQueries({ queryKey: key });
      return api.transferTerminalInputControl(session, source.id, {
        protocol_version: 1,
        expected_revision: expected,
        controller,
        acknowledge_uncertainty: acknowledge,
      });
    },
    retry: false,
    onSuccess: (next) =>
      client.setQueryData<InputControlStatus>(key, (previous) => newer(previous, next)),
    // Unknown responses reconcile current ownership; the action is never replayed.
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  return {
    offered,
    state: offered && !query.isError ? query.data : undefined,
    loading: offered && query.isPending,
    unavailable: offered && query.isError,
    pending: transition.isPending,
    error: transition.error,
    change: transition.mutateAsync,
    refresh: query.refetch,
  };
}
