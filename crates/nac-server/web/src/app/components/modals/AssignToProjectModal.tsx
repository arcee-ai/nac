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
      title="Assign to Project"
      size={ModalSize.Small}
      footer={
        <>
          <Button
            variant={ButtonVariant.Tertiary}
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
        <p className="text-small">
          <span className="text-basic-primary font-bold">{sessionTitle(summary)}</span> belongs to
          no project yet.
        </p>

        {existing ? (
          <div className="flex items-center gap-3 rounded-[8px] border border-muted p-3">
            <SessionAvatar id={existing.project_id} size={32} className="rounded-[4px]" />
            <div className="flex flex-col min-w-0">
              <span className="label-medium text-basic-primary truncate">{existing.name}</span>
              <span className="text-micro text-basic-muted truncate">{existing.cwd}</span>
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

        {error ? <p className="text-error-primary text-micro">{error}</p> : null}
      </div>
    </Modal>
  );
}
