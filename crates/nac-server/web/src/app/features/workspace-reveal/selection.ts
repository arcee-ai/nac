import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { SessionSnapshotResponse, WorkspaceFileList } from "@/app/types/api";

export interface RevealSelection {
  sessionId: string;
  selectedRoot: string;
  pathRoot: string;
  path: string;
}

/** The runtime's private cache shares a selection with the full-screen Files
 * panel. Refreshing a listing cannot reinterpret an already selected identity. */
export function useRevealSelection({
  sessionId,
  snapshot,
  listing,
  selected,
  current,
  active,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  listing: WorkspaceFileList | undefined;
  selected: string | null;
  current: string | null;
  active: boolean;
}) {
  const client = useQueryClient();
  const { selectFile } = useNativeRuntime().stores.sessionLayoutStore;
  const key = useMemo(
    () => ["workspace-reveal-selection", sessionId, current] as const,
    [sessionId, current],
  );
  const { data: origin } = useQuery<RevealSelection | null>({
    queryKey: key,
    enabled: false,
    gcTime: Infinity,
  });
  const capture = (path: string): RevealSelection | null => {
    const selectedRoot = snapshot?.workspace?.host_root;
    const pathRoot = listing?.path_root;
    return active &&
      snapshot?.metadata.session_id === sessionId &&
      selectedRoot?.startsWith("/") &&
      selectedRoot === snapshot.metadata.workspace_host_path &&
      pathRoot?.startsWith("/") &&
      listing?.files.includes(path)
      ? { sessionId, selectedRoot, pathRoot, path }
      : null;
  };
  const initial = current ? capture(current) : null;
  useEffect(() => {
    // The automatically displayed first change also originates in this listing.
    // A persisted selection without an origin needs explicit reselection.
    if (origin === undefined && selected === null && initial)
      client.setQueryData(key, (previous: RevealSelection | null | undefined) =>
        previous === undefined ? initial : previous,
      );
  }, [client, sessionId, current, selected, origin, initial, key]);
  return {
    origin: active ? (origin ?? null) : null,
    selectFile: (path: string) => {
      client.setQueryData(["workspace-reveal-selection", sessionId, path], capture(path));
      selectFile(path);
    },
  };
}
