import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";

import { localRevealRoot } from "./model";

/** Passive eligibility only. The server revalidates the current persisted
 * backend/root and no-follow target for each explicit user invocation. */
export function RevealInFinder({
  sessionId,
  snapshot,
  path,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  path: string;
}) {
  const runtime = useNativeRuntime();
  const { data: entries } = useQuery<ManagedSessionSummary[]>({
    queryKey: queryKeys.sessions(false),
    enabled: false,
  });
  const root = localRevealRoot(sessionId, snapshot, entries);
  if (!runtime.nativeDirectory || !root) return null;
  return (
    <RevealRequest
      key={`${sessionId}:${root}:${path}`}
      sessionId={sessionId}
      root={root}
      path={path}
    />
  );
}

function RevealRequest({
  sessionId,
  root,
  path,
}: {
  sessionId: string;
  root: string;
  path: string;
}) {
  const { api } = useNativeRuntime();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [api],
  );
  const reveal = async () => {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setFailure("");
    try {
      await api.revealWorkspacePath(sessionId, path, root, request.signal);
    } catch (error) {
      if (!request.signal.aborted)
        setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (!request.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        disabled={busy}
        onClick={reveal}
      >
        Reveal in Finder
      </Button>
      {failure ? (
        <span role="status" className="text-micro text-error-primary" title={failure}>
          {failure}
        </span>
      ) : null}
    </div>
  );
}
