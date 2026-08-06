import { useState } from "react";

import {
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
  Popover,
  PopoverPlacement,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { formatStoreTime } from "@/app/lib/format";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useWorkspaceRevisions } from "@/app/services/queries";
import type { WorkspaceRevision } from "@/app/types/api";

/** How a revision is named once it is no longer the working tree. */
const revisionTitle = (ordinal: number) => `Snapshot ${ordinal}`;

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
      className="flex items-start gap-2 w-full p-1 rounded-[4px] text-left btn-ghost"
      onClick={onClick}
    >
      <Icon
        iconName={selected ? IconName.Check : IconName.History}
        size={16}
        className="shrink-0 mt-[2px]"
      />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="label-micro text-btn-secondary truncate">{title}</span>
        {subtitle ? (
          <span className="label-micro text-basic-muted truncate">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="shrink-0 flex items-center gap-1 code code-small mt-[2px]">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The snapshot chip in the box footer, switching the panels between the live
 * working tree and the checkout as it stood at the end of an earlier run.
 *
 * Nothing here writes: picking a revision only changes what is read, so it is
 * safe during a run and needs none of the guards the branch picker carries.
 */
export function RevisionPicker({
  sessionId,
  selected,
  onSelect,
}: {
  sessionId: string;
  selected: number | null;
  onSelect: (revision: number | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useWorkspaceRevisions(sessionId);

  const revisions = data ?? [];
  // The list arrives newest first, so the oldest revision is number one.
  const ordinalOf = (index: number) => revisions.length - index;
  const selectedIndex = revisions.findIndex((item) => item.id === selected);
  const label =
    selectedIndex >= 0 ? revisionTitle(ordinalOf(selectedIndex)) : "Working tree";

  const pick = (revision: number | null) => {
    onSelect(revision);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      // The chip sits in the footer, so the panel has to grow upwards.
      placement={PopoverPlacement.TopRight}
      className="min-w-0"
      content={
        <>
          <Row
            title="Working tree"
            subtitle="The files as they are right now"
            selected={selected == null}
            onClick={() => pick(null)}
          />

          {isLoading ? (
            <div className="flex items-center gap-2 p-1 label-micro text-basic-muted">
              <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
              Reading snapshots…
            </div>
          ) : null}

          {error ? (
            <div className="p-1 label-micro text-error-primary">
              {errorMessage(error)}
            </div>
          ) : null}

          {!isLoading && !error ? (
            <div className="flex flex-col gap-1 max-h-[280px] overflow-auto [&>*]:shrink-0">
              {revisions.map((revision, index) => (
                <RevisionRow
                  key={revision.id}
                  revision={revision}
                  ordinal={ordinalOf(index)}
                  selected={revision.id === selected}
                  onClick={() => pick(revision.id)}
                />
              ))}
              {revisions.length === 0 ? (
                <div className="p-1 label-micro text-basic-muted">
                  No snapshots yet. One is taken every time a run finishes.
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      }
    >
      <button
        type="button"
        className={cn(
          "flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost",
          selected != null && "text-info-primary",
        )}
        aria-expanded={open}
        aria-label={`Snapshot: ${label}`}
        onClick={() => setOpen(!open)}
      >
        <Icon iconName={IconName.History} size={16} className="shrink-0" />
        <span className="label-micro text-btn-secondary truncate">{label}</span>
      </button>
    </Popover>
  );
}

function RevisionRow({
  revision,
  ordinal,
  selected,
  onClick,
}: {
  revision: WorkspaceRevision;
  ordinal: number;
  selected: boolean;
  onClick: () => void;
}) {
  const prompt = revision.label.trim();
  return (
    <Row
      title={`${revisionTitle(ordinal)} · ${formatStoreTime(revision.created_at)}`}
      subtitle={prompt || null}
      selected={selected}
      trailing={
        revision.additions || revision.deletions ? (
          <>
            <span className="text-success-primary">+{revision.additions}</span>
            <span className="text-error-primary">-{revision.deletions}</span>
          </>
        ) : null
      }
      onClick={onClick}
    />
  );
}
