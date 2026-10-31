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

/** Every reader of one terminal's control shares its cache and revision guard. */
function useControlQuery(session: string, id: string, enabled: boolean) {
  const { api } = useNativeRuntime();
  return useQuery({
    queryKey: inputOwnershipKey(session, id),
    queryFn: ({ signal }) => api.getTerminalInputControl(session, id, signal),
    enabled,
    retry: false,
    refetchInterval: enabled ? 1000 : false,
    structuralSharing: (previous, next) =>
      newer(previous as InputControlStatus | undefined, next as InputControlStatus),
  });
}

/** Current control is independent of immutable output frames and provenance. */
export function useInputOwnership(session: string, source: ExecutionStatus, readonly: boolean) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const key = inputOwnershipKey(session, source.id);
  const offered = mayOfferInputControl(source, readonly);
  const query = useControlQuery(session, source.id, offered);
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

/**
 * Who holds a live human shell's input, for chrome that only names it. The open
 * terminal already polls its own ownership, so its readers pass `poll` off and
 * share that cache.
 */
export function useShellController(
  session: string,
  source: ExecutionStatus | undefined,
  poll: boolean,
) {
  const watched = source?.origin === "human" && source.alive && mayOfferInputControl(source, false);
  const query = useControlQuery(session, source?.id ?? "", watched && poll);
  return watched && !query.isError ? query.data?.controller : undefined;
}
