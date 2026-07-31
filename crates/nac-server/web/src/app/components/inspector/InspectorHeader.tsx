import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { displaySessionTitle, shortId } from "@/app/lib/format";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import type { SessionMetadata, SessionSummarySnapshot } from "@/app/types/api";

interface ActionButtonProps {
  title: string;
  icon: IconName;
  onClick: () => void;
  variant?: ButtonVariant;
}

function ActionButton({
  title,
  icon,
  onClick,
  variant = ButtonVariant.Ghost,
}: ActionButtonProps) {
  return (
    <Tooltip title={title} position={TooltipPosition.BottomCenter}>
      <Button
        variant={variant}
        size={ButtonSize.Small}
        content={ButtonContent.Icon}
        onClick={onClick}
        aria-label={title}
      >
        <Icon iconName={icon} />
      </Button>
    </Tooltip>
  );
}

interface InspectorHeaderProps {
  sessionId: string;
  summary: SessionSummarySnapshot | null;
  metadata: SessionMetadata | null;
  running: boolean;
}

export function InspectorHeader({
  sessionId,
  summary,
  metadata,
  running,
}: InspectorHeaderProps) {
  const actions = useSessionActions();
  // Presentation (title, pin) only exists on the list summary, while cwd and
  // ssh host also live on the snapshot metadata.
  const cwd = summary?.cwd ?? metadata?.cwd ?? "";
  const sshHost = summary?.ssh_host ?? null;
  const title = displaySessionTitle(summary) || shortId(sessionId);

  return (
    <header className="flex items-center gap-3 px-3 h-14 border-b border-primary shrink-0">
      <div className="min-w-0 flex-grow">
        <div className="tag-label text-basic-muted">Inspector</div>
        <div className="header-small text-basic-primary truncate">{title}</div>
        <div className="text-micro text-basic-muted truncate font-mono">
          {shortId(sessionId)}
          {sshHost ? ` · ${sshHost}` : ""}
          {cwd ? ` · ${cwd}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {running && summary ? (
          <ActionButton
            title="Stop run"
            icon={IconName.Stop}
            variant={ButtonVariant.GhostDestructive}
            onClick={() => void actions.stopRun(summary)}
          />
        ) : null}
        <ActionButton
          title="Session settings"
          icon={IconName.Gear}
          onClick={() => actions.settings(sessionId)}
        />
        {summary ? (
          <>
            <ActionButton
              title="Rename"
              icon={IconName.Edit}
              onClick={() => actions.rename(summary)}
            />
            <ActionButton
              title="Delete session"
              icon={IconName.Trash}
              variant={ButtonVariant.GhostDestructive}
              onClick={() => actions.remove(summary)}
            />
          </>
        ) : null}
      </div>
    </header>
  );
}
