import { Button, ButtonContent, ButtonSize, ButtonVariant, SessionIllustration } from "@/app/atoms";
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
 * Shown in place of the whole list — rail and search bar included — while the
 * account has no projects and no loose chats, which is how the design frames
 * the state at every width. A filtered-away list keeps the regular chrome
 * instead.
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
        "flex h-full flex-col items-center justify-center py-16",
        mobile ? "px-4" : "px-6",
      )}
    >
      <div className="flex w-[420px] max-w-full flex-col items-center gap-6">
        <SessionIllustration />
        <div className="w-full text-center">
          <p className="header-2xl text-basic-primary">No projects yet</p>
          <p className="text-medium text-basic-tertiary">
            {managed
              ? "Connect a repository or create a Project from an existing path."
              : "Create your first and start building!"}
          </p>
        </div>
        {managed ? (
          <div
            className="grid w-full grid-cols-1 gap-2 rounded-lg border border-basic p-4 text-left sm:grid-cols-3"
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
          </div>
        ) : null}
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant={ButtonVariant.Primary}
            size={ButtonSize.Large}
            content={ButtonContent.Text}
            onClick={managed ? onAddRepository : onStart}
          >
            {managed ? "Add repository" : "Get Started"}
          </Button>
          {managed ? (
            <Button
              variant={ButtonVariant.Secondary}
              size={ButtonSize.Large}
              content={ButtonContent.Text}
              onClick={onStart}
            >
              Create Project
            </Button>
          ) : null}
          {managed && !githubConnected && onManagedSettings ? (
            <Button
              variant={ButtonVariant.Tertiary}
              size={ButtonSize.Large}
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
      <p className="text-small text-basic-tertiary">{label}</p>
      <p className={`label-small ${ready ? "text-success-primary" : "text-basic-primary"}`}>
        {value}
      </p>
    </div>
  );
}
