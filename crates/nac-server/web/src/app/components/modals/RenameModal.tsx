import { useId, useLayoutEffect, useRef, useState } from "react";

import { Button, ButtonContent, ButtonVariant, Input, Modal, ModalSize } from "@/app/atoms";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useUpdatePresentation } from "@/app/services/queries";
import { ApiError } from "@/app/services/api";
import type { SessionSummarySnapshot } from "@/app/types/api";
import { toRunError } from "@/app/lib/providerError";

interface RenameModalProps {
  open: boolean;
  onClose: () => void;
  summary: SessionSummarySnapshot | null;
}

type Presentation = Pick<SessionSummarySnapshot, "title" | "pinned" | "presentation_version">;

/** Keep revision authority per session, without retaining unrelated summary metadata. */
function rememberPresentation(
  known: ReadonlyMap<string, Presentation>,
  incoming: SessionSummarySnapshot,
): ReadonlyMap<string, Presentation> {
  const previous = known.get(incoming.session_id);
  if (previous && (previous.presentation_version ?? 0) >= (incoming.presentation_version ?? 0))
    return known;
  const { title, pinned, presentation_version } = incoming;
  return new Map(known).set(incoming.session_id, { title, pinned, presentation_version });
}

interface RenameDraft {
  title: string;
  pinned: boolean;
}

/** One submitted operation owns its draft until that request settles. */
interface PendingRename extends RenameDraft {
  sessionId: string;
  expectedVersion: number;
}

/** Presentation authority and in-flight writes outlive the form's exit animation. */
export function RenameModal({ open, onClose, summary }: RenameModalProps) {
  const mounted = useExitTransition(open);
  const toast = useToast();
  const update = useUpdatePresentation();
  const inFlight = useRef(new Map<string, PendingRename>());
  const [pending, setPending] = useState<ReadonlyMap<string, PendingRename>>(() => new Map());
  const [baselines, setBaselines] = useState<ReadonlyMap<string, Presentation>>(() => new Map());
  const visible = useRef<{ open: boolean; sessionId?: string; onClose: () => void } | null>(null);
  useLayoutEffect(() => {
    visible.current = { open, sessionId: summary?.session_id, onClose };
    return () => {
      visible.current = null;
    };
  }, [open, summary?.session_id, onClose]);

  const observed = summary ? rememberPresentation(baselines, summary) : baselines;
  if (observed !== baselines) setBaselines(observed);
  const current = summary ? { ...summary, ...observed.get(summary.session_id) } : null;

  const submit = async (draft: RenameDraft) => {
    if (
      !open ||
      !current ||
      !visible.current?.open ||
      visible.current.sessionId !== current.session_id ||
      inFlight.current.has(current.session_id)
    )
      return;
    const operation: PendingRename = {
      ...draft,
      sessionId: current.session_id,
      expectedVersion: current.presentation_version ?? 0,
    };
    // This synchronous guard also covers two submits before React rerenders.
    inFlight.current.set(operation.sessionId, operation);
    setPending(new Map(inFlight.current));
    try {
      const accepted = await update.mutateAsync({
        id: operation.sessionId,
        title: operation.title.trim(),
        pinned: operation.pinned,
        expectedVersion: operation.expectedVersion,
      });
      if (!visible.current || inFlight.current.get(operation.sessionId) !== operation) return;
      setBaselines((known) => rememberPresentation(known, accepted));
      toast.success("Session presentation saved");
      // A dismissed request may finish while a different session or modal is open.
      if (visible.current.open && visible.current.sessionId === operation.sessionId)
        visible.current.onClose();
    } catch (error) {
      if (!visible.current || inFlight.current.get(operation.sessionId) !== operation) return;
      const conflict = error instanceof ApiError && error.status === 409;
      toast.error(
        conflict
          ? "Version conflict — the session changed in the meantime"
          : `Error: ${errorMessage(toRunError(error))}`,
      );
    } finally {
      if (inFlight.current.get(operation.sessionId) === operation) {
        inFlight.current.delete(operation.sessionId);
        if (visible.current) setPending(new Map(inFlight.current));
      }
    }
  };

  if (!mounted || !current) return null;
  return (
    <RenameForm
      key={current.session_id}
      open={open}
      summary={current}
      pending={pending.get(current.session_id)}
      onClose={onClose}
      onSubmit={submit}
    />
  );
}

function RenameForm({
  open,
  summary,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  summary: SessionSummarySnapshot;
  pending?: PendingRename;
  onClose: () => void;
  onSubmit: (draft: RenameDraft) => Promise<void>;
}) {
  const sessionTitle = useSessionTitle();
  const formId = useId();
  const [title, setTitle] = useState(pending?.title ?? summary.title ?? "");
  const [pinned, setPinned] = useState(pending?.pinned ?? Boolean(summary.pinned));
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      // A reopen either resumes this session's accepted pending submission or
      // discards an abandoned draft using the latest presentation authority.
      setTitle(pending?.title ?? summary.title ?? "");
      setPinned(pending?.pinned ?? Boolean(summary.pinned));
    }
  }
  const saving = !!pending;
  const canPin = Boolean(summary.project_id);
  const submit = () => onSubmit({ title, pinned: canPin ? pinned : false });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename session"
      size={ModalSize.Small}
      footer={
        <>
          <Button
            variant={ButtonVariant.Tertiary}
            content={ButtonContent.Text}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            loading={saving}
          >
            Save
          </Button>
        </>
      }
    >
      {/* Enter submits through the form, which the browser holds back while an
          IME composition is still open. */}
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Title"
          placeholder={sessionTitle(summary) || "Session name"}
          hintText="Leave empty to restore the automatic title (last prompt)."
          value={title}
          loading={saving}
          onChange={(e) => setTitle(e.target.value)}
        />
        {canPin ? (
          <label className="flex items-center gap-2 label-small text-basic-secondary select-none">
            <input
              type="checkbox"
              checked={pinned}
              disabled={saving}
              onChange={(e) => setPinned(e.target.checked)}
              className="accent-[var(--color-fill-accent-primary)]"
            />
            Pin to top of the list
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
