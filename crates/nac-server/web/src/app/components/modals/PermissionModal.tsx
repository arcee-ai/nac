import { useEffect, useRef, useState } from "react";

import { Modal, ModalSize } from "@/app/atoms";
import {
  PermissionRequestPrompt,
  usePermissionAsks,
} from "@/app/components/inspector/PermissionControls";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { toRunError } from "@/app/lib/providerError";
import { toolLabel } from "@/app/lib/toolPresentation";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useReplyPermission } from "@/app/services/queries";
import type { PermissionReply, SessionBehavior } from "@/app/types/api";

export function PermissionModal({
  open,
  sessionId,
  behavior,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  behavior: SessionBehavior | null;
  onClose: () => void;
}) {
  const mounted = useExitTransition(open);
  if (!mounted || !sessionId) return null;
  return (
    <PermissionPrompt open={open} sessionId={sessionId} behavior={behavior} onClose={onClose} />
  );
}

function PermissionPrompt({
  open,
  sessionId,
  behavior,
  onClose,
}: {
  open: boolean;
  sessionId: string;
  behavior: SessionBehavior | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const replyPermission = useReplyPermission();
  const { asks, pending, ready } = usePermissionAsks(sessionId, behavior);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const active = asks[0] ?? null;

  useEffect(() => {
    if (!open || !ready || pending) return;
    onCloseRef.current();
  }, [open, pending, ready]);

  const reply = async (choice: PermissionReply) => {
    if (!active || replyingTo) return;
    setReplyingTo(active.request.id);
    try {
      await replyPermission.mutateAsync({
        sessionId: active.sessionId,
        requestId: active.request.id,
        reply: choice,
      });
    } catch (error) {
      toast.error(`Unable to answer permission request: ${errorMessage(toRunError(error))}`);
    } finally {
      setReplyingTo(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Permission required" size={ModalSize.Small}>
      {!ready ? (
        <p className="text-small text-basic-secondary">Loading permissions…</p>
      ) : active ? (
        <div className="flex flex-col gap-3">
          <p className="text-micro text-basic-muted">
            {toolLabel(active.request.tool)} is paused before execution.
          </p>
          <PermissionRequestPrompt
            request={active.request}
            extraWaiting={asks.length - 1}
            sourceLabel={active.sourceLabel}
            compact
            replyingTo={replyingTo}
            replyChoice={replyPermission.variables?.reply}
            onReply={(choice) => void reply(choice)}
          />
        </div>
      ) : (
        <p className="text-small text-basic-secondary">No pending permission request.</p>
      )}
    </Modal>
  );
}
