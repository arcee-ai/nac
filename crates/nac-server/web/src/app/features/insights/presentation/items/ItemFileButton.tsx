import { FileButton, FileButtonSize } from "@/app/atoms";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import { classifyMarkdownHref } from "@/app/lib/workspaceLink";

/** How the backend's `truncate_path` marks a path it shortened at the front. */
const CUT_MARK = "…";

type FileTarget = { kind: "workspace"; path: string } | { kind: "unmapped"; reason: string };

/** Where Files has the file, mapped the way a chat link to a workspace file is. */
function fileTarget(path: string, roots: ItemContext["workspaceRoots"]): FileTarget {
  if (path.startsWith(CUT_MARK)) {
    return {
      kind: "unmapped",
      reason: "Only the end of this path is known, so Files cannot open it.",
    };
  }
  const link = classifyMarkdownHref(path, roots);
  return link.kind === "workspace"
    ? { kind: "workspace", path: link.path }
    : { kind: "unmapped", reason: "This file is outside the workspace, so Files cannot open it." };
}

const fileName = (path: string) => path.split(/[\\/]/u).filter(Boolean).pop() ?? path;

interface ItemFileButtonProps {
  /** As the model wrote it: absolute, relative to the session's directory, or cut short. */
  path: string;
  context: ItemContext;
  additions?: number | null;
  deletions?: number | null;
}

/**
 * The design's FilesButtonWrapper: the file a call names, as a button that
 * opens it in Files. A path that maps onto no workspace file leaves the button
 * disabled, with the reason as its tooltip.
 */
export function ItemFileButton({ path, context, additions, deletions }: ItemFileButtonProps) {
  const target = fileTarget(path, context.workspaceRoots);
  const label = fileName(path);
  return (
    <div className="flex w-full flex-col items-start border-l-2 border-muted py-1 pl-4">
      {target.kind === "workspace" ? (
        <FileButton
          path={target.path}
          label={label}
          size={FileButtonSize.Small}
          additions={additions}
          deletions={deletions}
          onClick={() => context.openFile(target.path)}
        />
      ) : (
        // The button titles itself with its path, so it lets the pointer
        // through to the reason.
        <span title={target.reason} className="flex max-w-full cursor-not-allowed">
          <FileButton
            path={path}
            label={label}
            size={FileButtonSize.Small}
            disabled
            additions={additions}
            deletions={deletions}
            className="pointer-events-none"
          />
          <span className="sr-only">{target.reason}</span>
        </span>
      )}
    </div>
  );
}
