import { IconName } from "@/app/atoms";
import { RowActionButton } from "@/app/components/projects/RowActionButton";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import type { ProjectRecord } from "@/app/types/api";

/** Rename and delete at the end of a phone project row. */
export function ProjectRowActions({ project }: { project: ProjectRecord }) {
  const actions = useProjectActions();
  return (
    <>
      <RowActionButton
        icon={IconName.Edit}
        title="Rename project"
        label={`Rename ${project.name}`}
        isMobile
        onClick={() => actions.rename(project)}
      />
      <RowActionButton
        icon={IconName.Trash}
        title="Delete project"
        label={`Delete ${project.name}`}
        isMobile
        destructive
        onClick={() => actions.remove(project)}
      />
    </>
  );
}
