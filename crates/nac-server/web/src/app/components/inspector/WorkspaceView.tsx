import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { errorMessage } from "@/app/providers/ToastProvider";
import { queryKeys, useWorkspaceDiff } from "@/app/services/queries";
import type {
  ChangedFileStat,
  SessionSnapshotResponse,
  WorkspaceDiffHunk,
  WorkspaceDiffLine,
  WorkspaceDiffSection,
  WorkspaceFileDiff,
} from "@/app/types/api";

const MAX_FILES = 80;

// git rename/copy statuses have no meaningful single-file textual diff.
const isRenameOrCopy = (status: string) => /^[RC]/.test(status.trim());

function unsupportedLabel(status: string): string {
  const value = status.trim().toUpperCase();
  if (value.startsWith("C")) return "copy unsupported";
  if (value.startsWith("R")) return "rename unsupported";
  return "unsupported";
}

const STATUS_COLOR: Record<string, string> = {
  M: "text-danger-primary",
  A: "text-success-primary",
  D: "text-error-primary",
  R: "text-info-primary",
  "?": "text-basic-muted",
};

const statusColor = (status: string) =>
  STATUS_COLOR[status.trim()[0]] ?? "text-basic-secondary";

// Add/delete/hunk highlights are copied verbatim from the legacy UI; everything
// else in the app uses design tokens.
const HL_ADD = "rgba(79, 210, 168, 0.08)";
const HL_DEL = "rgba(220, 118, 126, 0.1)";
const HL_HUNK = "rgba(110, 168, 255, 0.11)";

const CELL = "px-2 py-[2px] align-top";
const GUTTER = cn(CELL, "text-right text-basic-muted select-none whitespace-nowrap");
const MARKER = cn(CELL, "text-center select-none whitespace-pre");
const CODE = cn(CELL, "whitespace-pre text-basic-primary");
const GUTTER_W = { minWidth: "44px", width: "1%" };
const CODE_W = { minWidth: "360px" };
const MARKER_W = { width: "28px" };

function DiffState({
  tone,
  children,
}: {
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md px-3 py-2 font-mono text-micro",
        tone === "error"
          ? "text-error-primary bg-error-tertiary border border-error-muted"
          : "text-basic-muted bg-elevation-level-0-5",
      )}
    >
      {children}
    </div>
  );
}

function DiffLineRow({ line }: { line: WorkspaceDiffLine }) {
  const isAdd = line.kind === "insert";
  const isDel = line.kind === "delete";
  const marker = isAdd ? "+" : isDel ? "-" : "\u00a0";
  const background = isAdd ? HL_ADD : isDel ? HL_DEL : undefined;
  const markerClass = isAdd
    ? "text-success-primary"
    : isDel
      ? "text-error-primary"
      : "text-basic-muted";

  return (
    <tr className="border-t border-white/[0.05]" style={background ? { background } : undefined}>
      <td className={GUTTER} style={GUTTER_W}>
        {line.old_lineno ?? ""}
      </td>
      <td className={cn(GUTTER, "border-r border-white/[0.05]")} style={GUTTER_W}>
        {line.new_lineno ?? ""}
      </td>
      <td className={cn(MARKER, markerClass)} style={MARKER_W}>
        {marker}
      </td>
      <td className={CODE} style={CODE_W}>
        {line.content}
        {line.has_trailing_newline === false ? (
          <span className="italic text-basic-muted"> No newline at end of file</span>
        ) : null}
      </td>
    </tr>
  );
}

function DiffHunkBody({ hunk }: { hunk: WorkspaceDiffHunk }) {
  const label =
    `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@` +
    (hunk.function_context ? ` ${hunk.function_context}` : "");

  return (
    <tbody>
      <tr className="font-semibold text-info-primary" style={{ background: HL_HUNK }}>
        <td className={GUTTER} style={GUTTER_W}>
          {hunk.old_start}
        </td>
        <td className={GUTTER} style={GUTTER_W}>
          {hunk.new_start}
        </td>
        <td className={MARKER} style={MARKER_W}>
          @@
        </td>
        <td className={cn(CELL, "whitespace-pre")} style={CODE_W}>
          {label}
        </td>
      </tr>
      {hunk.lines.map((line, index) => (
        <DiffLineRow key={index} line={line} />
      ))}
    </tbody>
  );
}

function DiffSectionBlock({ section }: { section: WorkspaceDiffSection }) {
  const flags = [
    section.binary ? "binary" : null,
    section.too_large ? "too large" : null,
    section.truncated ? "truncated" : null,
  ].filter(Boolean) as string[];
  const meta = [`${section.additions} additions`, `${section.deletions} deletions`, ...flags];
  const renderTable = !section.error && !section.binary && !section.too_large;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-micro">
        <div className="flex items-center gap-2 min-w-0">
          <span className="uppercase font-semibold text-success-primary">
            {section.stage}
          </span>
          <span className="text-basic-muted">{section.status}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-basic-muted">
          {meta.map((entry) => (
            <span key={entry}>{entry}</span>
          ))}
        </div>
      </div>

      {section.error ? <DiffState tone="error">Error: {section.error}</DiffState> : null}
      {section.binary ? (
        <DiffState>Binary or non-UTF-8 content; inline hunks are unavailable.</DiffState>
      ) : null}
      {section.too_large ? (
        <DiffState>File is too large for inline diff rendering.</DiffState>
      ) : null}
      {section.truncated ? (
        <div className="rounded-md px-3 py-2 font-mono text-micro text-basic-primary border border-secondary">
          Diff was truncated by the backend.
        </div>
      ) : null}

      {renderTable && section.hunks.length > 0 ? (
        <div className="overflow-auto rounded-md border border-secondary bg-elevation-level-0-5">
          <table
            className="w-full border-collapse font-mono text-micro leading-relaxed"
            style={{ minWidth: "620px" }}
          >
            {section.hunks.map((hunk, index) => (
              <DiffHunkBody key={index} hunk={hunk} />
            ))}
          </table>
        </div>
      ) : renderTable ? (
        <DiffState>No hunks for this section.</DiffState>
      ) : null}
    </div>
  );
}

function DiffBody({ diff }: { diff: WorkspaceFileDiff }) {
  const oldPath = diff.old_path && diff.old_path !== diff.path ? diff.old_path : null;
  const title = oldPath ? `${oldPath} -> ${diff.path}` : diff.path;

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-micro font-semibold text-basic-primary">
        <span className="min-w-0 break-all">{title}</span>
        <span className="text-basic-muted">
          {diff.sections.length} section{diff.sections.length === 1 ? "" : "s"}
        </span>
      </div>
      {diff.error ? <DiffState tone="error">{diff.error}</DiffState> : null}
      {diff.sections.length === 0 && !diff.error ? (
        <DiffState>No diff sections returned.</DiffState>
      ) : (
        diff.sections.map((section, index) => (
          <div key={index} className={index > 0 ? "border-t border-white/[0.05] pt-2" : ""}>
            <DiffSectionBlock section={section} />
          </div>
        ))
      )}
    </div>
  );
}

function FileRow({ sessionId, file }: { sessionId: string; file: ChangedFileStat }) {
  const [open, setOpen] = useState(false);
  const unsupported = isRenameOrCopy(file.status);
  const { data: diff, isFetching, error } = useWorkspaceDiff(
    sessionId,
    open ? file.path : null,
  );

  const header = (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-2 p-2 text-left",
        unsupported && "opacity-60 cursor-not-allowed",
      )}
      onClick={() => setOpen((v) => !v)}
      disabled={unsupported}
    >
      <Icon
        iconName={IconName.Down}
        className={cn(
          "transition-transform shrink-0",
          unsupported ? "opacity-0" : open ? "rotate-0" : "-rotate-90",
        )}
      />
      <span
        className={cn(
          "font-mono text-micro shrink-0 w-4 text-center",
          statusColor(file.status),
        )}
      >
        {file.status.trim()[0] ?? "?"}
      </span>
      <span className="label-small text-basic-primary truncate flex-grow font-mono">
        {file.path}
      </span>
      {file.additions != null ? (
        <span className="text-micro text-success-primary shrink-0">
          +{file.additions}
        </span>
      ) : null}
      {file.deletions != null ? (
        <span className="text-micro text-error-primary shrink-0">
          -{file.deletions}
        </span>
      ) : null}
      {unsupported ? (
        <span className="text-micro text-basic-muted shrink-0">
          {unsupportedLabel(file.status)}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="rounded-lg border border-secondary bg-elevation-level-1 overflow-hidden">
      {unsupported ? (
        <Tooltip
          title="Rename/copy has no single-file diff"
          position={TooltipPosition.TopCenter}
        >
          {header}
        </Tooltip>
      ) : (
        header
      )}

      {open ? (
        <div className="border-t border-secondary max-h-[420px] overflow-auto">
          {isFetching && !diff ? (
            <div className="p-3 flex items-center gap-2 text-basic-muted text-micro">
              <Loader size={LoaderSize.Small} /> Loading diff…
            </div>
          ) : null}
          {error ? (
            <div className="p-3 text-error-primary text-micro">
              {errorMessage(error)}
            </div>
          ) : null}
          {diff ? <DiffBody diff={diff} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Repo and branch summary plus changed files with an on-demand diff. */
export function WorkspaceView({
  sessionId,
  snapshot,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
}) {
  const client = useQueryClient();

  // Workspace stats are computed when the snapshot is built, so entering the
  // tab has to refetch it to show changes made since the last event.
  useEffect(() => {
    void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
  }, [client, sessionId]);

  if (!snapshot) {
    return <div className="p-6 text-basic-muted label-small">Loading…</div>;
  }

  const workspace = snapshot.workspace;
  const files = workspace.changed_files.slice(0, MAX_FILES);
  const hiddenCount = workspace.changed_files.length - files.length;

  return (
    <div className="h-full overflow-auto p-4 flex flex-col gap-3 [&>*]:shrink-0">
      <div className="rounded-xl border border-secondary bg-elevation-level-1 p-3 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Icon iconName={IconName.Folder} />
          <span className="label-small text-basic-primary truncate font-mono">
            {workspace.workspace_display || "workspace"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-micro text-basic-muted">
          {workspace.repo_label ? <span>{workspace.repo_label}</span> : null}
          {workspace.branch ? (
            <span className="flex items-center gap-1">
              <Icon iconName={IconName.Flow} size={14} /> {workspace.branch}
            </span>
          ) : null}
          <span className="text-success-primary">+{workspace.total_additions}</span>
          <span className="text-error-primary">-{workspace.total_deletions}</span>
        </div>
      </div>

      {workspace.error ? (
        <div className="text-error-primary label-small">{workspace.error}</div>
      ) : null}

      {files.length === 0 && !workspace.error ? (
        <div className="text-basic-muted label-small px-1">
          No changes in the workspace.
        </div>
      ) : (
        files.map((file) => (
          <FileRow key={file.path} sessionId={sessionId} file={file} />
        ))
      )}

      {hiddenCount > 0 ? (
        <div className="text-micro text-basic-muted px-1">
          Showing first {MAX_FILES} of {workspace.changed_files.length} changed files
          ({hiddenCount} more hidden).
        </div>
      ) : null}
    </div>
  );
}
