import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { PanelEmpty } from "@/app/components/inspector/PanelSplit";
import { cn } from "@/app/lib/cn";
import { revisionOrdinal, revisionTitle } from "@/app/lib/revisions";
import { formatStoreTime } from "@/app/lib/format";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useWorkspaceRevisions } from "@/app/services/queries";

function Row({
  title,
  subtitle,
  trailing,
  selected,
  onClick,
}: {
  title: string;
  subtitle: string | null;
  trailing?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-start gap-2 w-full p-2 rounded-[8px] text-left",
        selected ? "btn-ghost-highlighted" : "btn-ghost",
      )}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon
        iconName={selected ? IconName.Check : IconName.History}
        size={20}
        className="shrink-0 mt-[2px]"
      />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="label-medium text-basic-primary truncate">{title}</span>
        {subtitle ? (
          <span className="label-small text-basic-muted truncate">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="shrink-0 flex items-center gap-1 code code-small mt-[6px]">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Every revision the session has captured, newest first, with the live working
 * tree at the top. The wide box reaches these through the footer chip; a phone
 * has no footer, so they get a panel of their own.
 */
export function HistoryView({
  sessionId,
  selected,
  onSelect,
}: {
  sessionId: string;
  selected: number | null;
  onSelect: (revision: number | null) => void;
}) {
  const { data, isLoading, error } = useWorkspaceRevisions(sessionId);
  const revisions = data ?? [];

  if (error) {
    return <PanelEmpty>{errorMessage(error)}</PanelEmpty>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto p-2 gap-1 bg-elevation-level-1 [&>*]:shrink-0">
      <Row
        title="Working tree"
        subtitle="The files as they are right now"
        selected={selected == null}
        onClick={() => onSelect(null)}
      />
      {isLoading ? (
        <div className="flex items-center gap-2 p-2 label-small text-basic-muted">
          <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
          Reading snapshots…
        </div>
      ) : null}
      {revisions.map((revision, index) => (
        <Row
          key={revision.id}
          title={`${revisionTitle(revisionOrdinal(index, revisions.length))} · ${formatStoreTime(revision.created_at)}`}
          subtitle={revision.label.trim() || null}
          selected={revision.id === selected}
          trailing={
            revision.additions || revision.deletions ? (
              <>
                <span className="text-success-primary">+{revision.additions}</span>
                <span className="text-error-primary">-{revision.deletions}</span>
              </>
            ) : null
          }
          onClick={() => onSelect(revision.id)}
        />
      ))}
      {!isLoading && revisions.length === 0 ? (
        <div className="p-2 label-small text-basic-muted">
          No snapshots yet. One is taken every time a run finishes.
        </div>
      ) : null}
    </div>
  );
}
