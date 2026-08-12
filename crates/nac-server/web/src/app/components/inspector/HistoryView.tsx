import { Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { PanelEmpty } from "@/app/components/inspector/PanelSplit";
import { RevisionRowButton } from "@/app/components/inspector/RevisionRowButton";
import { revisionOrdinal, revisionTitle } from "@/app/lib/revisions";
import { formatStoreTime } from "@/app/lib/format";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useWorkspaceRevisions } from "@/app/services/queries";

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
      <RevisionRowButton
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
        <RevisionRowButton
          key={revision.id}
          title={`${revisionTitle(revisionOrdinal(index, revisions.length))} · ${formatStoreTime(revision.created_at)}`}
          subtitle={revision.label.trim() || null}
          selected={revision.id === selected}
          trailing={
            revision.additions || revision.deletions ? (
              <>
                <span className="text-success-primary">
                  +{revision.additions}
                </span>
                <span className="text-error-primary">
                  -{revision.deletions}
                </span>
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
