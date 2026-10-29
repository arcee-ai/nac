import { useId, useRef, useState } from "react";

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

/** Retain accepted presentation authority beyond the form's temporary exit lifetime. */
export function RenameModal({ open, onClose, summary }: RenameModalProps) {
  const mounted = useExitTransition(open);
  const [baselines, setBaselines] = useState<ReadonlyMap<string, Presentation>>(() => new Map());
  const observed = summary ? rememberPresentation(baselines, summary) : baselines;
  if (observed !== baselines) setBaselines(observed);
  const current = summary ? { ...summary, ...observed.get(summary.session_id) } : null;
  if (!mounted || !current) return null;
  return (
    <RenameForm
      key={current.session_id}
      open={open}
      summary={current}
      onClose={onClose}
      onSaved={(accepted) => setBaselines((known) => rememberPresentation(known, accepted))}
    />
  );
}

function RenameForm({
  open,
  summary,
  onClose,
  onSaved,
}: {
  open: boolean;
  summary: SessionSummarySnapshot;
  onClose: () => void;
  onSaved: (accepted: SessionSummarySnapshot) => void;
}) {
  const toast = useToast();
  const sessionTitle = useSessionTitle();
  const update = useUpdatePresentation();
  const formId = useId();
  // `isPending` only shows up on the next render, so a second Enter in the
  // same frame would otherwise send the write twice.
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(summary.title ?? "");
  const [pinned, setPinned] = useState(Boolean(summary.pinned));
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    // A canceled form can reopen before the exit timer unmounts it. Reset
    // that abandoned draft, but retain any accepted save and its ref guard.
    if (open && !saving) {
      setTitle(summary.title ?? "");
      setPinned(Boolean(summary.pinned));
    }
  }
  const canPin = Boolean(summary.project_id);

  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const accepted = await update.mutateAsync({
        id: summary.session_id,
        title: title.trim(),
        pinned: canPin ? pinned : false,
        expectedVersion: summary.presentation_version ?? 0,
      });
      onSaved(accepted);
      toast.success("Session presentation saved");
      onClose();
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      toast.error(
        conflict
          ? "Version conflict — the session changed in the meantime"
          : `Error: ${errorMessage(toRunError(error))}`,
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

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
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            loading={update.isPending}
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
          loading={update.isPending}
          onChange={(e) => setTitle(e.target.value)}
        />
        {canPin ? (
          <label className="flex items-center gap-2 label-small text-basic-secondary select-none">
            <input
              type="checkbox"
              checked={pinned}
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
