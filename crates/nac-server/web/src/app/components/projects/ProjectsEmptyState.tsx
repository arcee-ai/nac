import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

interface ProjectsEmptyStateProps {
  /** Opens the new-project dialog. */
  onStart: () => void;
  onAddRepository?: () => void;
  onManagedSettings?: () => void;
  modelReady?: boolean;
  githubConnected?: boolean;
  mobile: boolean;
}

/**
 * Home with no projects and no loose sessions: one calm "Add a project" card.
 * Managed hosts lead with "Add repository" and show what is ready.
 */
export function ProjectsEmptyState({
  onStart,
  onAddRepository,
  onManagedSettings,
  modelReady,
  githubConnected,
  mobile,
}: ProjectsEmptyStateProps) {
  const managed = onAddRepository != null;
  return (
    <div
      className={cn(
        "flex min-h-full flex-col items-center justify-center py-16",
        mobile ? "px-4" : "px-6",
      )}
    >
      <div className="flex w-[440px] max-w-full flex-col items-start gap-5 rounded-card border border-tertiary bg-elevation-level-1 p-6">
        <span className="flex size-10 items-center justify-center rounded-pill bg-[var(--f-wash-1)]">
          <Icon iconName={IconName.FolderOpen} size={18} className="text-basic-secondary" />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="type-meta text-basic-tertiary">No projects yet</p>
          <h1 className="type-title text-basic-primary">Add a project</h1>
          <p className="type-body-chrome text-basic-secondary">
            {managed
              ? "Connect a repository, or create a project from an existing path. Sessions start from there."
              : "Point NAC at a folder — on this machine, over SSH, or in a sandbox — and start your first session there."}
          </p>
        </div>
        {managed ? (
          <dl
            className="grid w-full grid-cols-3 gap-3 border-t border-muted pt-4"
            data-testid="managed-empty-status"
          >
            <ManagedState
              label="Arcee model"
              value={modelReady ? "Ready" : "Needs attention"}
              ready={Boolean(modelReady)}
            />
            <ManagedState
              label="GitHub"
              value={githubConnected ? "Connected" : "Not connected"}
              ready={Boolean(githubConnected)}
            />
            <ManagedState label="Projects" value="None" ready={false} />
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={ButtonVariant.Primary}
            size={mobile ? ButtonSize.Large : ButtonSize.Medium}
            content={ButtonContent.Text}
            onClick={managed ? onAddRepository : onStart}
          >
            {managed ? "Add repository" : "Get Started"}
          </Button>
          {managed ? (
            <Button
              variant={ButtonVariant.Secondary}
              size={mobile ? ButtonSize.Large : ButtonSize.Medium}
              content={ButtonContent.Text}
              onClick={onStart}
            >
              Create Project
            </Button>
          ) : null}
          {managed && !githubConnected && onManagedSettings ? (
            <Button
              variant={ButtonVariant.Ghost}
              size={mobile ? ButtonSize.Large : ButtonSize.Medium}
              content={ButtonContent.Text}
              onClick={onManagedSettings}
            >
              Connect GitHub
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ManagedState({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="type-meta text-basic-tertiary">{label}</dt>
      <dd className={cn("type-meta-strong", ready ? "text-success-primary" : "text-basic-primary")}>
        {value}
      </dd>
    </div>
  );
}
