import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  FileIcon,
  Icon,
  IconName,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { CommitPopover } from "@/app/components/inspector/CommitPopover";
import {
  PanelEmpty,
  PanelLoading,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { useIsDesktop, useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { statusLabelClass } from "@/app/lib/fileStatus";
import {
  buildFileTree,
  changedDirPaths,
  fileLabel,
  type FileNode,
  type FileTreeDir,
} from "@/app/lib/fileTree";
import {
  highlightCode,
  highlightDiff,
  type CodeToken,
} from "@/app/lib/highlight";
import { errorMessage } from "@/app/providers/ToastProvider";
import {
  queryKeys,
  useWorkspaceDiff,
  useWorkspaceFile,
  useWorkspaceFiles,
  useWorkspaceRevisionChanges,
} from "@/app/services/queries";
import {
  selectFile,
  selectFileListing,
  toggleFolder,
  useFileListing,
  useSelectedFile,
  useToggledFolders,
  type FileListing,
} from "@/app/store/sessionLayoutStore";
import type {
  ChangedFileStat,
  SessionSnapshotResponse,
  WorkspaceDiffLine,
  WorkspaceDiffSection,
  WorkspaceFileDiff,
} from "@/app/types/api";

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

/** One level of the file tree, indented by a guide line like Figma. */
function Tree({ dir, depth, open, selected, onToggle, onSelect }: TreeProps) {
  const isMobile = useIsMobile();
  return (
    // No `w-full`: as a flex child this already stretches, and a full width on
    // top of the indent margin would push every deep level a few pixels past
    // the panel and raise a horizontal scrollbar for nothing.
    <div
      className={cn(
        "flex flex-col gap-[2px]",
        depth > 0 && "pl-1 ml-[3px] border-l border-muted",
      )}
    >
      {dir.dirs.map((child) => {
        const expanded = open.has(child.path);
        return (
          <div key={child.path} className="flex flex-col gap-[2px] w-full">
            <PanelRow
              label={child.name}
              icon={<Chevron open={expanded} />}
              // Collapsed folders would otherwise hide where the work is.
              labelClassName={
                child.hasChanges ? "text-danger-primary" : undefined
              }
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
          title={file.path}
          labelClassName={statusLabelClass(file.status)}
          // The status letter used to sit here; the label colour already says
          // as much, so the slot shows what kind of file it is instead.
          icon={<FileIcon path={file.path} size={isMobile ? 24 : 16} />}
          onClick={() => onSelect(file.path)}
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
  if (files.length === 0) {
    return (
      <div className="p-1 label-micro text-basic-muted">
        Nothing has changed here yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[2px]">
      {files.map((file) => (
        <PanelRow
          key={file.path}
          label={fileLabel(file.path)}
          active={selected === file.path}
          title={file.path}
          labelClassName={statusLabelClass(file.status)}
          icon={<FileIcon path={file.path} size={isMobile ? 24 : 16} />}
          onClick={() => onSelect(file.path)}
        />
      ))}
    </div>
  );
}

function ListingButton({
  iconName,
  label,
  active,
  round = false,
  onClick,
}: {
  iconName: IconName;
  label: string;
  active: boolean;
  /** The phone's 40px circle around a 24px glyph, for the floating pill. */
  round?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className={round ? "btn-round" : undefined}
      size={round ? ButtonSize.Medium : ButtonSize.Small}
      variant={active ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
      content={ButtonContent.Icon}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon iconName={iconName} />
    </Button>
  );
}

/** How the files are listed, and the commit action. */
function ListToolbar({
  sessionId,
  listing,
  changed,
  revision,
}: {
  sessionId: string;
  listing: FileListing;
  changed: ChangedFileStat[];
  revision: number | null;
}) {
  const isMobile = useIsMobile();

  const listingButtons = (
    <>
      <ListingButton
        iconName={IconName.Folders}
        label="Show every file"
        active={listing === "tree"}
        round={isMobile}
        onClick={() => selectFileListing("tree")}
      />
      <ListingButton
        iconName={IconName.Scheme}
        label="Show changed files only"
        active={listing === "changed"}
        round={isMobile}
        onClick={() => selectFileListing("changed")}
      />
    </>
  );
  const commit = (
    <CommitPopover
      sessionId={sessionId}
      changed={changed}
      revision={revision}
    />
  );

  // A phone has no room for a bar of its own above the list, so the design
  // floats the same two controls over its last rows instead.
  if (isMobile) {
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 p-1 rounded-full bg-elevation-level-3 shadow-2xl">
          {listingButtons}
        </div>
        {commit}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 h-12 px-3 shrink-0 border-b border-muted @max-[560px]:gap-2 @max-[560px]:px-2">
      <div className="flex items-center gap-2 flex-1">{listingButtons}</div>
      {commit}
    </div>
  );
}

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
          : content}
        {trailing}
      </span>
    </div>
  );
}

function DiffLine({
  line,
  tokens,
}: {
  line: WorkspaceDiffLine;
  tokens: CodeToken[] | undefined;
}) {
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
          <span className="italic text-basic-muted">
            {" "}
            No newline at end of file
          </span>
        ) : null
      }
    />
  );
}

function Notice({
  tone,
  children,
}: {
  tone?: "error";
  children: React.ReactNode;
}) {
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
  if (section.error)
    return <Notice tone="error">Error: {section.error}</Notice>;
  if (section.binary) {
    return (
      <Notice>
        Binary or non-UTF-8 content; inline hunks are unavailable.
      </Notice>
    );
  }
  if (section.too_large) {
    return <Notice>File is too large for inline diff rendering.</Notice>;
  }
  if (section.hunks.length === 0)
    return <Notice>No hunks for this section.</Notice>;

  return (
    <div className="pb-[128px] md:pb-0">
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
            <DiffLine
              key={lineIndex}
              line={line}
              tokens={highlighted.get(line)}
            />
          ))}
        </div>
      ))}
      {section.truncated ? (
        <Notice>Diff was truncated by the backend.</Notice>
      ) : null}
    </div>
  );
}

/** Header shared by both panes: the file's name, with counts or size beside it. */
function PaneHeader({
  path,
  trailing,
}: {
  path: string;
  trailing: React.ReactNode;
}) {
  // On a phone the dialog chrome already names the file and carries the badge,
  // so this bar would only repeat them.
  const isDesktop = useIsDesktop();
  if (!isDesktop) return null;

  return (
    <div
      className="flex items-center gap-2 h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-0-5"
      title={path}
    >
      <div className="flex flex-1 items-center gap-[6px] min-w-0">
        <FileIcon path={path} />
        <span className="label-micro text-btn-secondary truncate">
          {fileLabel(path)}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 code code-small">
        {trailing}
      </div>
    </div>
  );
}

function Scroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto py-2 [&>*]:shrink-0">
      {children}
    </div>
  );
}

function DiffPane({
  sessionId,
  file,
  revision,
}: {
  sessionId: string;
  file: FileNode;
  revision: number | null;
}) {
  const {
    data: diff,
    isFetching,
    error,
  } = useWorkspaceDiff(sessionId, file.path, "all", 3, revision);

  // `git diff --numstat` covers only tracked files, so an untracked one arrives
  // without counts and the diff itself is the only place they exist.
  const counts = useMemo(() => {
    if (file.additions != null || file.deletions != null) {
      return { additions: file.additions ?? 0, deletions: file.deletions ?? 0 };
    }
    if (!diff) return null;
    return diff.sections.reduce(
      (total, section) => ({
        additions: total.additions + section.additions,
        deletions: total.deletions + section.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  }, [file, diff]);

  return (
    <>
      <PaneHeader
        path={file.path}
        trailing={
          counts ? (
            <>
              <span className="text-success-primary">+{counts.additions}</span>
              <span className="text-error-primary">-{counts.deletions}</span>
            </>
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
  const [highlighted, setHighlighted] = useState<
    Map<WorkspaceDiffLine, CodeToken[]>
  >(() => new Map());

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
  if (diff.sections.length === 0)
    return <Notice>No diff sections returned.</Notice>;
  return (
    <>
      {diff.sections.map((section, index) => (
        <Section key={index} section={section} highlighted={highlighted} />
      ))}
    </>
  );
}

const formatBytes = (size: number) =>
  size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`;

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
  const { data, isFetching, error } = useWorkspaceFile(
    sessionId,
    path,
    revision,
  );
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
            <span className="text-basic-muted">{formatBytes(data.size)}</span>
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
        {data?.binary ? (
          <Notice>Binary file; nothing to show inline.</Notice>
        ) : null}
        {data?.too_large ? (
          <Notice>
            File is too large to display ({formatBytes(data.size)}).
          </Notice>
        ) : null}
        {lines
          ? lines.map((content, index) => (
              <CodeLine
                key={index}
                lineNo={index + 1}
                content={content}
                tokens={tokens?.[index]}
              />
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
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  revision?: number | null;
}) {
  const client = useQueryClient();
  // Shared rather than local: the same panel also renders inside the
  // full-screen dialog, and it has to open on the file you were reading.
  const selected = useSelectedFile();
  const toggled = useToggledFolders();
  const fileListing = useFileListing();

  const {
    data: listing,
    isLoading,
    error,
  } = useWorkspaceFiles(sessionId, revision);
  const revisionChanges = useWorkspaceRevisionChanges(sessionId, revision);

  // Workspace stats are computed when the snapshot is built, so entering the
  // panel has to refetch it to show changes made since the last event. A
  // revision is frozen, so it never needs this.
  useEffect(() => {
    if (revision != null) return;
    void client.invalidateQueries({ queryKey: queryKeys.sessionSnapshot(sessionId) });
  }, [client, sessionId, revision]);

  const workspace = snapshot?.workspace ?? null;
  const changed = useMemo(
    () =>
      revision == null
        ? (workspace?.changed_files ?? [])
        : (revisionChanges.data?.changed_files ?? []),
    [revision, workspace, revisionChanges.data],
  );

  const nodes = useMemo(
    () => mergeStatuses(listing?.files ?? [], changed),
    [listing, changed],
  );
  const tree = useMemo(() => buildFileTree(nodes), [nodes]);
  // Taken from the merged nodes rather than from `changed` directly, because an
  // untracked directory arrives from git as one entry and has to be spread back
  // over the files inside it.
  const changedNodes = useMemo(
    () => nodes.filter((node) => node.status !== null),
    [nodes],
  );

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

  const failure = error ?? (revision != null ? revisionChanges.error : null);
  if (revision == null && workspace?.error) {
    return (
      <div className="p-6 label-small text-error-primary">
        {workspace.error}
      </div>
    );
  }
  if (failure) {
    return (
      <div className="p-6 label-small text-error-primary">
        {errorMessage(failure)}
      </div>
    );
  }
  if (isLoading || !listing) {
    return <PanelLoading listTitle="Files" />;
  }

  return (
    <PanelSplit
      listTitle="Files"
      title={current?.split("/").pop()}
      actions={
        currentChange &&
        (currentChange.additions || currentChange.deletions) ? (
          <div className="flex items-center gap-2 shrink-0 code code-small">
            <span className="text-success-primary">
              +{currentChange.additions ?? 0}
            </span>
            <span className="text-error-primary">
              -{currentChange.deletions ?? 0}
            </span>
          </div>
        ) : null
      }
      listToolbar={
        <ListToolbar
          sessionId={sessionId}
          listing={fileListing}
          changed={changed}
          revision={revision}
        />
      }
      list={
        nodes.length === 0 ? (
          <div className="p-1 label-micro text-basic-muted">
            No files in the workspace.
          </div>
        ) : fileListing === "changed" ? (
          <ChangedList
            files={changedNodes}
            selected={current}
            onSelect={selectFile}
          />
        ) : (
          <>
            <Tree
              dir={tree}
              depth={0}
              open={open}
              selected={current}
              onToggle={toggleFolder}
              onSelect={selectFile}
            />
            {listing.truncated ? (
              <div className="p-1 label-micro text-basic-muted">
                Listing truncated.
              </div>
            ) : null}
          </>
        )
      }
    >
      {!current ? (
        <PanelEmpty>
          {nodes.length === 0
            ? "No files in the workspace."
            : "Select a file to see it."}
        </PanelEmpty>
      ) : currentChange ? (
        <DiffPane
          key={current}
          sessionId={sessionId}
          file={currentChange}
          revision={revision}
        />
      ) : (
        <FilePane
          key={current}
          sessionId={sessionId}
          path={current}
          revision={revision}
        />
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
function mergeStatuses(
  files: string[],
  changed: ChangedFileStat[],
): FileNode[] {
  const exact = new Map(changed.map((file) => [file.path, file]));
  const prefixes = changed.filter((file) => file.path.endsWith("/"));

  const nodes = files.map((path) => {
    const match =
      exact.get(path) ?? prefixes.find((entry) => path.startsWith(entry.path));
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
