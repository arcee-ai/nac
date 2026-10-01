import { useContext, useEffect, useRef } from "react";
import { RegistryContext } from "@effect/atom-react";

import { atomRefresh, refreshPrefixed } from "@/app/effect/remote";
import { perfMark } from "@/app/lib/perfDebug";
import { atomIds } from "@/app/services/queries/keys";
import { sessionSnapshotAtom } from "@/app/services/queries/session";
import { useWorkspaceEpoch } from "@/app/store/runtimeStore";

/**
 * Slowest the checkout is reread while a run keeps changing it. Every reread
 * runs git on the session's working tree, so a busy run is rate-limited rather
 * than followed command for command.
 */
const REREAD_INTERVAL_MS = 3000;

/** Every cached read of one workspace view for this session. */
function workspacePrefix(
  sessionId: string,
  segment: "workspace-files" | "workspace-diff" | "workspace-file",
): string {
  return `${atomIds.session(sessionId)}\u0000${segment}`;
}

/**
 * Keep the workspace views following a run that is still in progress.
 *
 * The diff endpoint reads the live working tree, but nothing refreshed it
 * between runs, so an hour-long run showed the checkout as it stood when the
 * panel was opened. Only the atoms something is actually watching refetch,
 * which is why this can be driven straight off the event stream.
 *
 * A revision is a frozen commit and never needs any of this.
 */
export function useLiveWorkspace(sessionId: string, revision: number | null): void {
  const registry = useContext(RegistryContext);
  const epoch = useWorkspaceEpoch();
  const timer = useRef<number | null>(null);
  const lastReread = useRef(0);

  useEffect(() => {
    if (revision != null || epoch === 0) return;
    // Already waiting out the interval: the newer events are covered by the
    // reread that is coming, so they must not push it further away.
    if (timer.current !== null) return;
    const wait = Math.max(0, REREAD_INTERVAL_MS - (Date.now() - lastReread.current));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      lastReread.current = Date.now();
      perfMark("query:invalidate.workspace", { throttleMs: 0 });
      // The changed-file list and its totals are computed while the snapshot is
      // built, so they only move when the snapshot does.
      void atomRefresh.run(registry, sessionSnapshotAtom(sessionId));
      void refreshPrefixed(registry, workspacePrefix(sessionId, "workspace-files"));
      void refreshPrefixed(registry, workspacePrefix(sessionId, "workspace-diff"));
      void refreshPrefixed(registry, workspacePrefix(sessionId, "workspace-file"));
    }, wait);
  }, [registry, epoch, revision, sessionId]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
}
