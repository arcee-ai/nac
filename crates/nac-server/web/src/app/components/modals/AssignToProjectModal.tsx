import { useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonVariant,
  Input,
  InputSize,
  Modal,
  ModalSize,
  SessionAvatar,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { projectForSessionLocation, projectLocationPayload } from "@/app/lib/projects";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { useToast } from "@/app/providers/ToastProvider";
import { useAssignSessionToProject, useCreateProject, useProjects } from "@/app/services/queries";
import type { SessionSummarySnapshot } from "@/app/types/api";

/**
 * Adopts a session that belongs to no project.
 *
 * A session keeps its own working directory and the backend refuses to file it
 * anywhere else, so there is no project to choose: either one already covers
 * this location, or the modal offers to create it.
 */
export function AssignToProjectModal({
  open,
  onClose,
  summary,
}: {
  open: boolean;
  onClose: () => void;
  summary: SessionSummarySnapshot | null;
}) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const sessionTitle = useSessionTitle();
  const { data: projectList } = useProjects();
  const assign = useAssignSessionToProject();
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(
    () => projectForSessionLocation(projectList?.projects ?? [], summary),
    [projectList, summary],
  );

  const busy = assign.isPending || createProject.isPending;

  const submit = async () => {
    if (!summary || busy) return;
    setError(null);
    try {
      const project =
        existing ??
        (await createProject.mutateAsync({
          name: name.trim() || null,
          ...projectLocationPayload(summary),
        }));
      await assign.mutateAsync({
        projectId: project.project_id,
        sessionId: summary.session_id,
      });
      toast.success(`Assigned to ${project.name}`);
      onClose();
    } catch (assignError) {
      setError(humanErrorText(toRunError(assignError)));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign to project"
      size={ModalSize.Small}
      footer={
        <>
          <Button
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Text}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
          >
            {existing ? "Assign" : "Create and assign"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p>
          <span className="text-basic-primary">“{sessionTitle(summary)}”</span> belongs to no
          project yet.{" "}
          {existing
            ? "A project already covers its working directory:"
            : "Create a project for its working directory:"}
        </p>

        {existing ? (
          <div className="flex items-center gap-3 rounded-card border border-tertiary bg-elevation-level-1 p-3">
            <SessionAvatar id={existing.project_id} size={32} className="rounded-sm" />
            <div className="flex min-w-0 flex-col">
              <span className="type-label truncate text-basic-primary">{existing.name}</span>
              <span className="type-meta truncate text-basic-tertiary">{existing.cwd}</span>
            </div>
          </div>
        ) : (
          <>
            <Input
              label="Project name"
              inputSize={isMobile ? InputSize.Large : InputSize.Medium}
              placeholder="Taken from the git remote"
              value={name}
              onChange={(event) => {
                setError(null);
                setName(event.target.value);
              }}
            />
          </>
        )}

        {error ? (
          <p role="alert" className="type-meta text-error-primary">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
