import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import {
  WORKING_TREE_LABEL,
  type FilesSource,
  type FilesSourceState,
  type RevisionCapture,
} from "@/app/lib/filesSource";
import { formatStoreTime } from "@/app/lib/format";
import { revisionTitle } from "@/app/lib/revisions";

const shortRunId = (runId: string) => runId.slice(0, 8);

function headline(source: FilesSource, state: FilesSourceState): string {
  if (source.kind === "working-tree") {
    if (state.status === "pending") return "Working tree — loading…";
    if (state.status === "unavailable") return "Working tree — unavailable";
    return WORKING_TREE_LABEL;
  }
  const name = source.capture ? revisionTitle(source.capture.ordinal) : "Captured snapshot";
  if (state.status === "pending") return `${name} — loading capture…`;
  if (state.status === "unavailable") return `${name} — capture unavailable`;
  return `${name} — captured after a run`;
}

/**
 * What a capture's changes are measured against. Each capture is compared
 * with the one before it, and the first with the commit checked out then, so
 * the first one also carries whatever the checkout already held.
 */
function baseline({ ordinal, record }: RevisionCapture): string {
  if (record.base_sha == null) return "Nothing earlier to compare with";
  if (ordinal <= 1) return "Changes since the last commit, including earlier edits";
  return `Changes since ${revisionTitle(ordinal - 1)}`;
}

/**
 * The line above the Files list saying which source its rows describe, with
 * the way back to the working tree whenever it describes something else.
 */
export function FilesSourceLabel({
  source,
  state,
  autoSelected,
  onReturn,
}: {
  source: FilesSource;
  state: FilesSourceState;
  /** The open file was picked for the reader, not by them. */
  autoSelected: boolean;
  onReturn: () => void;
}) {
  const capture = source.kind === "revision" ? source.capture : null;
  const record = capture?.record ?? null;

  return (
    <div
      role="status"
      aria-label="Files source"
      className="flex flex-col gap-1 rounded-md px-2 py-1.5 bg-elevation-level-0-5"
    >
      <span
        className={cn(
          "flex min-w-0 items-start gap-1.5 label-micro",
          source.kind === "revision" ? "text-info-primary" : "text-basic-primary",
          state.status === "unavailable" && "text-error-primary",
        )}
      >
        <Icon
          iconName={source.kind === "revision" ? IconName.History : IconName.Folder}
          size={16}
          className="shrink-0"
        />
        <span className="min-w-0">{headline(source, state)}</span>
      </span>
      {record ? (
        <span
          className="label-micro text-basic-muted break-words"
          title={`Run ${record.run_id}, commit ${record.commit_sha}`}
        >
          Run {shortRunId(record.run_id)} · captured {formatStoreTime(record.created_at)}
        </span>
      ) : null}
      {capture && state.status === "ready" ? (
        <span className="label-micro text-basic-muted">{baseline(capture)}</span>
      ) : null}
      {state.status === "unavailable" ? (
        <span className="label-micro text-basic-muted">{state.reason}</span>
      ) : null}
      {autoSelected && state.status === "ready" ? (
        <span className="label-micro text-basic-muted">
          Opened first for navigation only; it does not say who changed it.
        </span>
      ) : null}
      {source.kind === "revision" ? (
        <Button
          variant={ButtonVariant.Tertiary}
          size={ButtonSize.Small}
          content={ButtonContent.IconLeft}
          className="self-start"
          onClick={onReturn}
        >
          <Icon iconName={IconName.Left} size={16} className="shrink-0" />
          Back to working tree
        </Button>
      ) : null}
    </div>
  );
}
