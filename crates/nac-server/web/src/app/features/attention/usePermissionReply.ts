import { useCallback, useRef, useState } from "react";

import type { PermissionQueueEntry } from "@/app/features/permissions/usePermissionQueue";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useReplyPermission } from "@/app/services/queries";
import type { PermissionReply } from "@/app/types/api";

export interface PermissionReplyState {
  /** Answers one request in its own broker scope. Resolves whether the server took it. */
  reply: (entry: PermissionQueueEntry, choice: PermissionReply) => Promise<boolean>;
  /** The request and choice in flight, if any; one reply at a time. */
  replying: { key: string; choice: PermissionReply } | null;
}

/**
 * The one way a pending request is answered, shared by the attention card and
 * the permission sheet. A reply always goes to the broker that owns the
 * request — never the visible session — and stays off while that broker
 * cannot be read, so a cached request is never answered blind.
 */
export function usePermissionReply(): PermissionReplyState {
  const replyPermission = useReplyPermission();
  const toast = useToast();
  const [replying, setReplying] = useState<PermissionReplyState["replying"]>(null);
  // State lags a double click by a render; the ref does not.
  const inFlight = useRef(false);

  const reply = useCallback(
    async (entry: PermissionQueueEntry, choice: PermissionReply) => {
      if (inFlight.current || entry.scope.query.isError || entry.scope.query.isPending) {
        return false;
      }
      inFlight.current = true;
      setReplying({ key: entry.key, choice });
      try {
        await replyPermission.mutateAsync({
          sessionId: entry.scope.sessionId,
          requestId: entry.request.id,
          reply: choice,
        });
        return true;
      } catch (error) {
        toast.error(`Unable to answer permission request: ${errorMessage(toRunError(error))}`);
        return false;
      } finally {
        inFlight.current = false;
        setReplying(null);
      }
    },
    [replyPermission, toast],
  );

  return { reply, replying };
}
