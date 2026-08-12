import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries";
import { useWorkspaceEpoch } from "@/app/store/runtimeStore";

/**
 * Slowest the checkout is reread while a run keeps changing it. Every reread
 * runs git on the session's working tree, so a busy run is rate-limited rather
 * than followed command for command.
 */
const REREAD_INTERVAL_MS = 3000;

/**
 * Keep the workspace views following a run that is still in progress.
 *
 * The diff endpoint reads the live working tree, but nothing invalidated it
 * between runs, so an hour-long run showed the checkout as it stood when the
 * panel was opened. Only the queries something is actually watching refetch,
 * which is why this can be driven straight off the event stream.
 *
 * A revision is a frozen commit and never needs any of this.
 */
export function useLiveWorkspace(
  sessionId: string,
  revision: number | null,
): void {
  const client = useQueryClient();
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
      // The changed-file list and its totals are computed while the snapshot is
      // built, so they only move when the snapshot does.
      void client.invalidateQueries({
        queryKey: queryKeys.sessionSnapshot(sessionId),
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: queryKeys.workspaceFilesRoot(sessionId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.workspaceDiffRoot(sessionId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.workspaceFileRoot(sessionId),
      });
    }, wait);
  }, [client, epoch, revision, sessionId]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
}
