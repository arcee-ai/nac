import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Icon, IconName, Loader, LoaderSize } from "@/app/atoms";
import {
  PanelEmpty,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { cn } from "@/app/lib/cn";
import {
  allDirPaths,
  buildFileTree,
  fileLabel,
  type FileTreeDir,
} from "@/app/lib/fileTree";
import { highlightDiff, type CodeToken } from "@/app/lib/highlight";
import { errorMessage } from "@/app/providers/ToastProvider";
import { queryKeys, useWorkspaceDiff } from "@/app/services/queries";
import type {
  ChangedFileStat,
  SessionSnapshotResponse,
  WorkspaceDiffLine,
  WorkspaceDiffSection,
  WorkspaceFileDiff,
} from "@/app/types/api";

const MAX_FILES = 200;

// git rename/copy statuses have no meaningful single-file textual diff.
const isRenameOrCopy = (status: string) => /^[RC]/.test(status.trim());

const STATUS_COLOR: Record<string, string> = {
  M: "text-danger-primary",
  A: "text-success-primary",
  D: "text-error-primary",
  R: "text-info-primary",
  "?": "text-basic-muted",
};

const statusColor = (status: string) =>
  STATUS_COLOR[status.trim()[0]] ?? "text-basic-secondary";

function Chevron({ open }: { open: boolean }) {
  return (
    <Icon
      iconName={IconName.Right}
      size={16}
      className={cn("shrink-0 transition-transform", open && "rotate-90")}
    />
  );
}

interface TreeProps {
  dir: FileTreeDir;
  depth: number;
  open: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

/** One level of the changed-file tree, indented by a guide line like Figma. */
function Tree({ dir, depth, open, selected, onToggle, onSelect }: TreeProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-[2px] w-full",
        depth > 0 && "pl-1 ml-[11px] border-l border-muted",
      )}
    >
      {dir.dirs.map((child) => {
        const expanded = open.has(child.path);
        return (
          <div key={child.path} className="flex flex-col gap-[2px] w-full">
            <PanelRow
              label={child.name}
              icon={<Chevron open={expanded} />}
              onClick={() => onToggle(child.path)}
            />
            {expanded ? (
              <Tree
                dir={child}
                depth={depth + 1}
                open={open}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
      {dir.files.map((file) => (
        <PanelRow
          key={file.path}
          label={fileLabel(file.path)}
          active={selected === file.path}
          icon={
            <span
              className={cn(
                "code code-micro w-4 shrink-0 text-center",
                statusColor(file.status),
              )}
            >
              {file.status.trim()[0] ?? "?"}
            </span>
          }
          onClick={() => onSelect(file.path)}
        />
      ))}
    </div>
  );
}

function CodeLine({
  line,
  tokens,
}: {
  line: WorkspaceDiffLine;
  tokens: CodeToken[] | undefined;
}) {
  const isAdd = line.kind === "insert";
  const isDel = line.kind === "delete";
  // A deleted line still belongs to the old file, so it keeps the old number.
  const lineNo = isDel ? line.old_lineno : (line.new_lineno ?? line.old_lineno);

  return (
    <div
      className={cn(
        "flex items-start w-full border-l-2 border-solid",
        isAdd
          ? "bg-success-primary border-success-primary"
          : isDel
            ? "bg-error-primary border-error-primary"
            : "border-transparent",
      )}
    >
      <span className="shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none">
        {lineNo ?? ""}
      </span>
      <span className="flex-1 min-w-0 px-2 code code-small text-basic-primary whitespace-pre-wrap break-words">
        {tokens
          ? tokens.map((token, index) => (
              <span key={index} className={token.className ?? undefined}>
                {token.text}
              </span>
            ))
          : line.content}
        {line.has_trailing_newline === false ? (
          <span className="italic text-basic-muted"> No newline at end of file</span>
        ) : null}
      </span>
    </div>
  );
}

function Notice({ tone, children }: { tone?: "error"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mx-4 my-2 rounded-md px-3 py-2 code code-small",
        tone === "error"
          ? "text-error-primary bg-error-tertiary border border-error-muted"
          : "text-basic-muted bg-elevation-level-0-5",
      )}
    >
      {children}
    </div>
  );
}

function Section({
  section,
  highlighted,
}: {
  section: WorkspaceDiffSection;
  highlighted: Map<WorkspaceDiffLine, CodeToken[]>;
}) {
  if (section.error) return <Notice tone="error">Error: {section.error}</Notice>;
  if (section.binary) {
    return <Notice>Binary or non-UTF-8 content; inline hunks are unavailable.</Notice>;
  }
  if (section.too_large) {
    return <Notice>File is too large for inline diff rendering.</Notice>;
  }
  if (section.hunks.length === 0) return <Notice>No hunks for this section.</Notice>;

  return (
    <>
      {section.hunks.map((hunk, index) => (
        <div key={index} className="flex flex-col w-full">
          <div className="flex items-start w-full border-l-2 border-transparent bg-info-tertiary">
            <span className="shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none">
              @@
            </span>
            <span className="flex-1 min-w-0 px-2 code code-small text-info-primary truncate">
              {`-${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines}`}
              {hunk.function_context ? ` ${hunk.function_context}` : ""}
            </span>
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <CodeLine key={lineIndex} line={line} tokens={highlighted.get(line)} />
          ))}
        </div>
      ))}
      {section.truncated ? <Notice>Diff was truncated by the backend.</Notice> : null}
    </>
  );
}

function DiffPane({
  sessionId,
  file,
}: {
  sessionId: string;
  file: ChangedFileStat;
}) {
  const unsupported = isRenameOrCopy(file.status);
  const {
    data: diff,
    isFetching,
    error,
  } = useWorkspaceDiff(sessionId, unsupported ? null : file.path);

  return (
    <>
      <div
        className="flex items-center gap-[10px] h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-1"
        title={file.path}
      >
        <div className="flex flex-1 items-center gap-[6px] min-w-0">
          <span className="label-micro text-btn-secondary truncate">
            {fileLabel(file.path)}
          </span>
          <Icon iconName={IconName.Folder} size={16} className="shrink-0" />
        </div>
        <div className="flex items-center gap-2 shrink-0 code code-small">
          <span className="text-success-primary">+{file.additions ?? 0}</span>
          <span className="text-error-primary">-{file.deletions ?? 0}</span>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-auto py-2 [&>*]:shrink-0">
        {unsupported ? (
          <Notice>
            git reports this as a rename or copy, which has no single-file diff.
          </Notice>
        ) : null}
        {isFetching && !diff ? (
          <div className="flex items-center gap-2 px-4 py-2 code code-small text-basic-muted">
            <Loader size={LoaderSize.Small} /> Loading diff…
          </div>
        ) : null}
        {error ? <Notice tone="error">{errorMessage(error)}</Notice> : null}
        {diff ? <DiffSections diff={diff} /> : null}
      </div>
    </>
  );
}

function DiffSections({ diff }: { diff: WorkspaceFileDiff }) {
  const [highlighted, setHighlighted] = useState<Map<WorkspaceDiffLine, CodeToken[]>>(
    () => new Map(),
  );

  // The highlighter is loaded on demand, so the diff renders as plain text
  // first and gains its colours a frame later. A map left over from another
  // file is keyed by that file's line objects, so it simply never matches.
  useEffect(() => {
    let active = true;
    void highlightDiff(diff.path, diff.sections).then((result) => {
      if (active) setHighlighted(result);
    });
    return () => {
      active = false;
    };
  }, [diff]);

  if (diff.error) return <Notice tone="error">{diff.error}</Notice>;
  if (diff.sections.length === 0) return <Notice>No diff sections returned.</Notice>;
  return (
    <>
      {diff.sections.map((section, index) => (
        <Section key={index} section={section} highlighted={highlighted} />
      ))}
    </>
  );
}

/** Changed files as a folder tree, with the selected file's diff beside it. */
export function ChangesView({
  sessionId,
  snapshot,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  // Workspace stats are computed when the snapshot is built, so entering the
  // panel has to refetch it to show changes made since the last event.
  useEffect(() => {
    void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
  }, [client, sessionId]);

  const workspace = snapshot?.workspace ?? null;
  const files = useMemo(
    () => (workspace?.changed_files ?? []).slice(0, MAX_FILES),
    [workspace],
  );
  const tree = useMemo(() => buildFileTree(files), [files]);
  // Directories start expanded, so the open set is the complement of `closed`.
  const open = useMemo(() => {
    const paths = allDirPaths(tree).filter((path) => !closed.has(path));
    return new Set(paths);
  }, [tree, closed]);

  const current =
    files.find((file) => file.path === selected) ?? files[0] ?? null;

  if (!snapshot) {
    return <PanelEmpty>Loading…</PanelEmpty>;
  }
  if (workspace?.error) {
    return (
      <div className="p-6 label-small text-error-primary">{workspace.error}</div>
    );
  }
  if (files.length === 0) {
    return <PanelEmpty>No changes in the workspace.</PanelEmpty>;
  }

  const toggle = (path: string) =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <PanelSplit
      list={
        <Tree
          dir={tree}
          depth={0}
          open={open}
          selected={current?.path ?? null}
          onToggle={toggle}
          onSelect={setSelected}
        />
      }
    >
      {current ? (
        <DiffPane key={current.path} sessionId={sessionId} file={current} />
      ) : (
        <PanelEmpty>Select a file to see its diff.</PanelEmpty>
      )}
    </PanelSplit>
  );
}
