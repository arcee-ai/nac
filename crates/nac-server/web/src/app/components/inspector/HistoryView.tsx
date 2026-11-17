import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import { PanelQuiet } from "@/app/components/inspector/PanelQuiet";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { revisionOrdinal, revisionTitle } from "@/app/lib/revisions";
import { formatStoreTime } from "@/app/lib/format";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useWorkspaceRevisions } from "@/app/services/queries";

function Row({
  title,
  meta,
  subtitle,
  trailing,
  selected,
  onClick,
}: {
  title: string;
  meta?: string;
  subtitle: string | null;
  trailing?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full min-h-11 items-start gap-3 rounded-md px-3 py-2.5 text-left",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
        selected ? "bg-[var(--f-wash-2)]" : "hover:bg-[var(--f-wash-1)]",
      )}
      aria-pressed={selected}
      // Spoken as "Snapshot 3 · Nov 4, 10:12", then its label.
      aria-label={[meta ? `${title} · ${meta}` : title, subtitle].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {selected ? (
          <Icon iconName={IconName.Check} size={16} className="text-basic-primary" />
        ) : (
          <Icon iconName={IconName.History} size={14} className="text-basic-muted" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate type-label text-basic-primary">{title}</span>
          {meta ? (
            <span className="shrink-0 type-meta tabular text-basic-muted">{meta}</span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="type-meta text-basic-tertiary break-words">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5 type-meta tabular">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Every revision the session has captured, newest first, with the live working
 * tree at the top. A wide screen also switches these from the session header;
 * the selection here is the same one the Changes panel and that picker read.
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
  const isMobile = useIsMobile();
  const { data, isLoading, error } = useWorkspaceRevisions(sessionId);
  const revisions = data ?? [];

  if (error) {
    return (
      <PanelQuiet tone="error" live="alert">
        {errorMessage(error)}
      </PanelQuiet>
    );
  }

  return (
    // A phone's panel runs under its floating header and above the tab bar.
    <div
      className={cn(
        "flex flex-col flex-1 min-h-0 overflow-auto gap-0.5 [&>*]:shrink-0",
        isMobile ? "px-2 pt-16 pb-32" : "px-3 py-3",
      )}
    >
      <Row
        title="Working tree"
        subtitle="The files as they are right now"
        selected={selected == null}
        onClick={() => onSelect(null)}
      />
      {revisions.length > 0 || isLoading ? (
        <p className="px-3 pt-4 pb-1 type-meta text-basic-muted">Snapshots</p>
      ) : null}
      {isLoading ? (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 type-meta text-basic-tertiary"
        >
          <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
          Reading snapshots…
        </div>
      ) : null}
      {revisions.map((revision, index) => (
        <Row
          key={revision.id}
          title={revisionTitle(revisionOrdinal(index, revisions.length))}
          meta={formatStoreTime(revision.created_at)}
          subtitle={revision.label.trim() || null}
          selected={revision.id === selected}
          trailing={
            revision.additions || revision.deletions ? (
              <>
                <span className="text-[var(--f-green-text)]">+{revision.additions}</span>
                <span className="text-[var(--f-red-text)]">−{revision.deletions}</span>
              </>
            ) : null
          }
          onClick={() => onSelect(revision.id)}
        />
      ))}
      {!isLoading && revisions.length === 0 ? (
        <p className="px-3 pt-4 type-meta text-basic-tertiary">
          No snapshots yet. One is taken every time a run finishes.
        </p>
      ) : null}
    </div>
  );
}
