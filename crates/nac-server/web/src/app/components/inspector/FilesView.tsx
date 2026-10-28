import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  CodeChangesBadge,
  CodeChangesBadgeSize,
  FileIcon,
  FileListTabButton,
  FileListTabButtonSize,
  FileListTabButtonVariant,
  GitStatus,
  gitStatusOf,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { FilesBranchRow, FilesListToolbar } from "@/app/components/inspector/FilesListControls";
import {
  PanelEmptyState,
  PanelFailure,
  PanelListNote,
} from "@/app/components/inspector/PanelMessages";
import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useLiveWorkspace } from "@/app/hooks/useLiveWorkspace";
import { useIsDesktop, useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import {
  buildFileTree,
  changedDirPaths,
  fileLabel,
  type FileNode,
  type FileTreeDir,
} from "@/app/lib/fileTree";
import { highlightCode, highlightDiff, tokenStyle, type CodeToken } from "@/app/lib/highlight";
import { errorMessage } from "@/app/providers/ToastProvider";
import {
  queryKeys,
  useWorkspaceDiff,
  useWorkspaceFile,
  useWorkspaceFiles,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";
import type {
  ChangedFileStat,
  SessionSnapshotResponse,
  WorkspaceDiffLine,
  WorkspaceDiffSection,
  WorkspaceFileDiff,
} from "@/app/types/api";

const rowSize = (isMobile: boolean) =>
  isMobile ? FileListTabButtonSize.Large : FileListTabButtonSize.Small;

/** A file in the tree or the changed list, tinted and lettered by its git status. */
function FileRow({
  file,
  size,
  selected,
  onSelect,
}: {
  file: FileNode;
  size: FileListTabButtonSize;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <FileListTabButton
      name={fileLabel(file.path)}
      path={file.path}
      size={size}
      active={selected === file.path}
      status={gitStatusOf(file.status)}
      title={file.path}
      onClick={() => onSelect(file.path)}
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

/** One level of the file tree, indented by a guide line like Figma. */
function Tree({ dir, depth, open, selected, onToggle, onSelect }: TreeProps) {
  const isMobile = useIsMobile();
  return (
    <div className={cn("flex flex-col gap-[2px]", depth > 0 && "mb-2 border-l border-muted pl-2")}>
      {dir.dirs.map((child) => {
        const expanded = open.has(child.path);
        return (
          <div key={child.path} className="flex flex-col gap-[2px] w-full">
            <FileListTabButton
              name={child.name}
              variant={FileListTabButtonVariant.Folder}
              size={rowSize(isMobile)}
              active={expanded}
              // Collapsed folders would otherwise hide where the work is.
              status={child.hasChanges ? GitStatus.Changed : null}
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
        <FileRow
          key={file.path}
          file={file}
          size={rowSize(isMobile)}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/** Flat list of what git reports as changed, with the folders left out. */
function ChangedList({
  files,
  selected,
  onSelect,
}: {
  files: FileNode[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const isMobile = useIsMobile();
  if (files.length === 0) return <PanelListNote>Nothing has changed here yet.</PanelListNote>;

  return (
    <div className="flex flex-col gap-1">
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          size={rowSize(isMobile)}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * The design's Plex Mono Medium 12/16 without tracking. `.code` sets a 1.5
 * line height and tracking in unlayered CSS, which only `!` utilities outrank.
 */
const CODE_TYPE = "code code-small font-medium !leading-4 !tracking-normal";

const GUTTER = cn(CODE_TYPE, "shrink-0 w-12 text-right opacity-50 text-basic-muted select-none");

function CodeLine({
  lineNo,
  content,
  tokens,
  tone,
  trailing,
}: {
  lineNo: number | null;
  content: string;
  tokens: CodeToken[] | undefined;
  tone?: "add" | "delete";
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start w-full border-l-2 border-solid",
        tone === "add"
          ? "bg-success-primary border-success-primary"
          : tone === "delete"
            ? "bg-error-primary border-error-primary"
            : "border-transparent",
      )}
    >
      <span className={GUTTER}>{lineNo ?? ""}</span>
      <span
        className={cn(
          CODE_TYPE,
          "flex-1 min-w-0 px-2 text-basic-primary whitespace-pre-wrap break-words",
        )}
      >
        {tokens
          ? tokens.map((token, index) => (
              <span key={index} style={tokenStyle(token)}>
                {token.text}
              </span>
            ))
          : content}
        {trailing}
      </span>
    </div>
  );
}

function DiffLine({ line, tokens }: { line: WorkspaceDiffLine; tokens: CodeToken[] | undefined }) {
  const isDel = line.kind === "delete";
  // A deleted line still belongs to the old file, so it keeps the old number.
  const lineNo = isDel ? line.old_lineno : (line.new_lineno ?? line.old_lineno);

  return (
    <CodeLine
      lineNo={lineNo}
      content={line.content}
      tokens={tokens}
      tone={line.kind === "insert" ? "add" : isDel ? "delete" : undefined}
      trailing={
        line.has_trailing_newline === false ? (
          <span className="italic text-basic-muted"> No newline at end of file</span>
        ) : null
      }
    />
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
            <span className={GUTTER}>@@</span>
            <span className={cn(CODE_TYPE, "flex-1 min-w-0 px-2 text-info-primary truncate")}>
              {`-${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines}`}
              {hunk.function_context ? ` ${hunk.function_context}` : ""}
            </span>
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <DiffLine key={lineIndex} line={line} tokens={highlighted.get(line)} />
          ))}
        </div>
      ))}
      {section.truncated ? <Notice>Diff was truncated by the backend.</Notice> : null}
    </>
  );
}

/** The open file as the design heads it on every size: its type icon, then its name. */
function FileTitle({ path }: { path: string }) {
  const isMobile = useIsMobile();
  return (
    <span className="flex min-w-0 items-center gap-[10px]" title={path}>
      <FileIcon path={path} size={isMobile ? 24 : 20} />
      <span className="min-w-0 truncate">{fileLabel(path)}</span>
    </span>
  );
}

/** Header shared by both panes: the file, with its counts or size right after it. */
function PaneHeader({ path, trailing }: { path: string; trailing: React.ReactNode }) {
  // Below the desktop width the panel's own header names the file instead.
  const isDesktop = useIsDesktop();
  if (!isDesktop) return null;

  return (
    <div className="flex items-center gap-[10px] h-12 px-4 shrink-0 border-b border-muted bg-elevation-ground header-sm text-basic-primary">
      <FileTitle path={path} />
      {trailing}
    </div>
  );
}

function Scroller({ children }: { children: React.ReactNode }) {
  // A phone's header floats over the top of the code rather than above it.
  const isMobile = useIsMobile();
  return (
    <div
      className={cn(
        "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
        isMobile ? "py-16" : "py-2",
      )}
    >
      {children}
    </div>
  );
}

interface ChangeCounts {
  additions: number;
  deletions: number;
}

/**
 * Lines a changed file added and removed. `git diff --numstat` covers only
 * tracked files, so an untracked one arrives without counts and the diff
 * itself is the only place they exist.
 */
function useChangeCounts(
  sessionId: string,
  file: FileNode | undefined,
  revision: number | null,
): ChangeCounts | null {
  const counted = file != null && (file.additions != null || file.deletions != null);
  const { data: diff, isPlaceholderData } = useWorkspaceDiff(
    sessionId,
    file && !counted ? file.path : null,
    "all",
    3,
    revision,
  );
  return useMemo(() => {
    if (!file) return null;
    if (counted) return { additions: file.additions ?? 0, deletions: file.deletions ?? 0 };
    // A placeholder is the previous file's diff, whose counts are not this one's.
    if (!diff || isPlaceholderData) return null;
    return diff.sections.reduce(
      (total, section) => ({
        additions: total.additions + section.additions,
        deletions: total.deletions + section.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  }, [file, counted, diff, isPlaceholderData]);
}

function DiffPane({
  sessionId,
  file,
  counts,
  revision,
}: {
  sessionId: string;
  file: FileNode;
  counts: ChangeCounts | null;
  revision: number | null;
}) {
  const {
    data: diff,
    isFetching,
    error,
  } = useWorkspaceDiff(sessionId, file.path, "all", 3, revision);

  return (
    <>
      <PaneHeader
        path={file.path}
        trailing={
          counts ? (
            <CodeChangesBadge additions={counts.additions} deletions={counts.deletions} />
          ) : null
        }
      />
      <Scroller>
        {isFetching && !diff ? (
          <div className="flex items-center gap-2 px-4 py-2 code code-small text-basic-muted">
            <Loader size={LoaderSize.Small} /> Loading diff…
          </div>
        ) : null}
        {error ? <Notice tone="error">{errorMessage(error)}</Notice> : null}
        {diff ? <DiffSections diff={diff} /> : null}
      </Scroller>
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

const formatBytes = (size: number) => (size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`);

/** A file with nothing to diff, shown as its contents. */
function FilePane({
  sessionId,
  path,
  revision,
}: {
  sessionId: string;
  path: string;
  revision: number | null;
}) {
  const { data, isFetching, error } = useWorkspaceFile(sessionId, path, revision);
  // Kept next to the text it describes, so a refetch that changes the file
  // cannot pair the new lines with the old colours.
  const [highlighted, setHighlighted] = useState<{
    text: string;
    lines: CodeToken[][];
  } | null>(null);

  // A trailing newline would otherwise show up as a phantom last line.
  const text = data?.content?.replace(/\n$/, "") ?? null;
  const lines = useMemo(() => text?.split("\n") ?? null, [text]);

  useEffect(() => {
    if (text === null) return undefined;
    let active = true;
    void highlightCode(path, text).then((result) => {
      if (active && result) setHighlighted({ text, lines: result });
    });
    return () => {
      active = false;
    };
  }, [path, text]);

  const tokens = highlighted?.text === text ? highlighted.lines : null;

  return (
    <>
      <PaneHeader
        path={path}
        trailing={
          data ? (
            <span className={cn(CODE_TYPE, "shrink-0 text-basic-muted")}>
              {formatBytes(data.size)}
            </span>
          ) : null
        }
      />
      <Scroller>
        {isFetching && !data ? (
          <div className="flex items-center gap-2 px-4 py-2 code code-small text-basic-muted">
            <Loader size={LoaderSize.Small} /> Loading file…
          </div>
        ) : null}
        {error ? <Notice tone="error">{errorMessage(error)}</Notice> : null}
        {data?.binary ? <Notice>Binary file; nothing to show inline.</Notice> : null}
        {data?.too_large ? (
          <Notice>File is too large to display ({formatBytes(data.size)}).</Notice>
        ) : null}
        {lines
          ? lines.map((content, index) => (
              <CodeLine key={index} lineNo={index + 1} content={content} tokens={tokens?.[index]} />
            ))
          : null}
      </Scroller>
    </>
  );
}

/**
 * The files of the checkout — either all of them as a folder tree or only what
 * git reports as changed — with the selected one shown beside the list: its
 * diff when it has changed, its contents when it has not.
 *
 * With a revision selected the same lists describe the checkout as it stood at
 * the end of that run, and "changed" means what that run changed.
 */
export function FilesView({
  sessionId,
  snapshot,
  revision = null,
  readOnly = false,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  revision?: number | null;
  readOnly?: boolean;
}) {
  const { useToggledFolders, useSelectedFile, useFileListing, toggleFolder, selectFile } =
    useNativeRuntime().stores.sessionLayoutStore;

  const client = useQueryClient();
  const isMobile = useIsMobile();
  // Shared rather than local: the same panel also renders inside the
  // full-screen dialog, and it has to open on the file you were reading.
  const selected = useSelectedFile();
  const toggled = useToggledFolders();
  const fileListing = useFileListing();

  const { data: listing, error } = useWorkspaceFiles(sessionId, revision);
  const revisionChanges = useWorkspaceRevisionChanges(sessionId, revision);

  // Workspace stats are computed when the snapshot is built, so entering the
  // panel has to refetch it to show changes made since the last event. A
  // revision is frozen, so it never needs this.
  useEffect(() => {
    if (revision != null) return;
    void client.invalidateQueries({
      queryKey: queryKeys.sessionSnapshot(sessionId),
    });
  }, [client, sessionId, revision]);
  useLiveWorkspace(sessionId, revision);

  const workspace = snapshot?.workspace ?? null;
  const changed = useMemo(
    () =>
      revision == null
        ? (workspace?.changed_files ?? [])
        : (revisionChanges.data?.changed_files ?? []),
    [revision, workspace, revisionChanges.data],
  );

  const nodes = useMemo(() => mergeStatuses(listing?.files ?? [], changed), [listing, changed]);
  const tree = useMemo(() => buildFileTree(nodes), [nodes]);
  // Taken from the merged nodes rather than from `changed` directly, because an
  // untracked directory arrives from git as one entry and has to be spread back
  // over the files inside it.
  const changedNodes = useMemo(() => nodes.filter((node) => node.status !== null), [nodes]);

  // Folders start closed — a whole repository is too much to show at once —
  // except along the paths that lead to a change, which is what the panel is
  // usually opened for. Each manual toggle flips one folder from that default.
  const open = useMemo(() => {
    const result = new Set(changedDirPaths(tree));
    for (const path of toggled) {
      if (!result.delete(path)) result.add(path);
    }
    return result;
  }, [tree, toggled]);

  // Keyed by the merged nodes, not by `changed`: git reports an untracked
  // directory as one entry, so its files are only ever known per file here, and
  // looking them up in `changed` would show them as unchanged contents.
  const changedByPath = useMemo(
    () => new Map(changedNodes.map((node) => [node.path, node])),
    [changedNodes],
  );
  // Landing on the first change keeps the panel useful the moment it opens.
  const current = selected ?? changedNodes[0]?.path ?? null;
  const currentChange = current ? changedByPath.get(current) : undefined;
  const counts = useChangeCounts(sessionId, currentChange, revision);
  // A phone opens on the list, before any file is open, so only a file you
  // opened is marked there; the first change is merely where the detail lands.
  const marked = isMobile ? selected : current;

  const failure = error ?? (revision != null ? revisionChanges.error : null);
  if (revision == null && workspace?.error) {
    return <PanelFailure listTitle="Files">{workspace.error}</PanelFailure>;
  }
  if (failure) {
    return <PanelFailure listTitle="Files">{errorMessage(failure)}</PanelFailure>;
  }
  // Only when there is nothing to show at all. A listing already on screen —
  // this revision's, or the one before it while the switch is fetched — stays
  // put, and the bar above the panel carries the news that a fetch is running.
  if (!listing) {
    return <PanelLoading listTitle="Files" />;
  }

  const branch = workspace?.branch;
  // A phone's only branch switcher, so an empty checkout keeps it as well.
  const branchRow =
    isMobile && branch ? (
      <FilesBranchRow sessionId={sessionId} branch={branch} readOnly={readOnly} />
    ) : null;
  if (nodes.length === 0) {
    return <PanelEmptyState listTitle="Files" title="No Files" phoneLead={branchRow} />;
  }

  return (
    <PanelSplit
      listTitle="Files"
      title={current ? <FileTitle path={current} /> : undefined}
      titleAction={
        counts ? (
          <CodeChangesBadge
            additions={counts.additions}
            deletions={counts.deletions}
            size={isMobile ? CodeChangesBadgeSize.Medium : CodeChangesBadgeSize.Small}
          />
        ) : null
      }
      listToolbar={
        <FilesListToolbar
          sessionId={sessionId}
          listing={fileListing}
          changed={changed}
          revision={revision}
          readOnly={readOnly}
        />
      }
      list={
        <>
          {branchRow}
          {fileListing === "changed" ? (
            <ChangedList files={changedNodes} selected={marked} onSelect={selectFile} />
          ) : (
            <>
              <Tree
                dir={tree}
                depth={0}
                open={open}
                selected={marked}
                onToggle={toggleFolder}
                onSelect={selectFile}
              />
              {listing.truncated ? <PanelListNote>Listing truncated.</PanelListNote> : null}
            </>
          )}
        </>
      }
    >
      {!current ? (
        <PanelEmpty>Select a file to see it.</PanelEmpty>
      ) : currentChange ? (
        <DiffPane
          key={current}
          sessionId={sessionId}
          file={currentChange}
          counts={counts}
          revision={revision}
        />
      ) : (
        <FilePane key={current} sessionId={sessionId} path={current} revision={revision} />
      )}
    </PanelSplit>
  );
}

/**
 * Pairs the project listing with what git reports as changed. An untracked
 * directory arrives as a single entry ending in a slash, so its files are
 * matched by prefix; anything changed but unlisted is added so it cannot
 * vanish from the tree.
 */
function mergeStatuses(files: string[], changed: ChangedFileStat[]): FileNode[] {
  const exact = new Map(changed.map((file) => [file.path, file]));
  const prefixes = changed.filter((file) => file.path.endsWith("/"));

  const nodes = files.map((path) => {
    const match = exact.get(path) ?? prefixes.find((entry) => path.startsWith(entry.path));
    return {
      path,
      status: match?.status ?? null,
      additions: match?.additions ?? null,
      deletions: match?.deletions ?? null,
    };
  });

  const listed = new Set(files);
  for (const file of changed) {
    if (listed.has(file.path) || file.path.endsWith("/")) continue;
    nodes.push({
      path: file.path,
      status: file.status,
      additions: file.additions ?? null,
      deletions: file.deletions ?? null,
    });
  }

  return nodes;
}
