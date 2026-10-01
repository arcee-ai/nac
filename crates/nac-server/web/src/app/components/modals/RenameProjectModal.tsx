import { useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { Button, ButtonContent, ButtonVariant, Input, Modal, ModalSize } from "@/app/atoms";
import { ClientRequestError } from "@/app/effect/errors";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ApiError } from "@/app/services/api";
import { updateProjectAtom } from "@/app/services/queries";
import type { ProjectRecord } from "@/app/types/api";

function commandError(cause: unknown): unknown {
  return cause instanceof ClientRequestError ? cause.error : cause;
}

/** Mounted only while open, so the fields start from the current record. */
export function RenameProjectModal({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectRecord | null;
}) {
  const mounted = useExitTransition(open);
  if (!mounted || !project) return null;
  return <RenameForm key={project.project_id} open={open} project={project} onClose={onClose} />;
}

function RenameForm({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: ProjectRecord;
  onClose: () => void;
}) {
  const toast = useToast();
  const update = useAtomSet(updateProjectAtom, { mode: "promise" });
  const updating = useAtomValue(updateProjectAtom).waiting;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");

  const submit = async () => {
    if (updating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("A project needs a name");
      return;
    }
    try {
      await update({
        projectId: project.project_id,
        payload: {
          name: trimmed,
          // An empty box means no description, which the API spells as null.
          description: description.trim() || null,
        },
      });
      toast.success("Project saved");
      onClose();
    } catch (caught) {
      const error = commandError(caught);
      const conflict = error instanceof ApiError && error.status === 409;
      toast.error(
        conflict
          ? "Version conflict — the project changed in the meantime"
          : `Error: ${errorMessage(toRunError(error))}`,
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename project"
      size={ModalSize.Small}
      footer={
        <>
          <Button
            variant={ButtonVariant.Tertiary}
            content={ButtonContent.Text}
            onClick={onClose}
            disabled={updating}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={submit}
            loading={updating}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <Input
          label="Description"
          placeholder="Optional"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </div>
    </Modal>
  );
}
