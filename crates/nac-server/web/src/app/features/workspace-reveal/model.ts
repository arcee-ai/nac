import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";

export function localRevealRoot(
  sessionId: string,
  snapshot: SessionSnapshotResponse | null,
  entries: ManagedSessionSummary[] | undefined,
): string | null {
  const summary = entries?.find((entry) => entry.summary.session_id === sessionId)?.summary;
  if (
    !summary ||
    summary.sandboxed ||
    summary.ssh_host ||
    snapshot?.metadata.session_id !== sessionId
  )
    return null;
  const root = snapshot.metadata.workspace_host_path;
  return root?.startsWith("/") && root === snapshot.workspace?.host_root ? root : null;
}
