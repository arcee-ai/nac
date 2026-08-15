import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonVariant,
  Input,
  Modal,
  ModalSize,
} from "@/app/atoms";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { displaySessionTitle } from "@/app/lib/format";
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

/** Mounted only while open, so the fields start from the current presentation. */
export function RenameModal({ open, onClose, summary }: RenameModalProps) {
  const mounted = useExitTransition(open);
  if (!mounted || !summary) return null;
  return (
    <RenameForm
      key={summary.session_id}
      open={open}
      summary={summary}
      onClose={onClose}
    />
  );
}

function RenameForm({
  open,
  summary,
  onClose,
}: {
  open: boolean;
  summary: SessionSummarySnapshot;
  onClose: () => void;
}) {
  const toast = useToast();
  const update = useUpdatePresentation();
  const [title, setTitle] = useState(summary.title ?? "");
  const [pinned, setPinned] = useState(Boolean(summary.pinned));

  const submit = async () => {
    if (update.isPending) return;
    try {
      await update.mutateAsync({
        id: summary.session_id,
        title: title.trim(),
        pinned,
        expectedVersion: summary.presentation_version ?? 0,
      });
      toast.success("Session presentation saved");
      onClose();
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      toast.error(
        conflict
          ? "Version conflict — the session changed in the meantime"
          : `Error: ${errorMessage(toRunError(error))}`,
      );
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
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={submit}
            loading={update.isPending}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Title"
          placeholder={displaySessionTitle(summary) || "Session name"}
          hintText="Leave empty to restore the automatic title (last prompt)."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <label className="flex items-center gap-2 label-small text-basic-secondary select-none">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="accent-[var(--color-fill-accent-primary)]"
          />
          Pin to top of the list
        </label>
      </div>
    </Modal>
  );
}
