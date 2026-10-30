import { FileButton, FileButtonSize } from "@/app/atoms";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import { classifyMarkdownHref } from "@/app/lib/workspaceLink";

/** How the backend's `truncate_path` marks a path it shortened at the front. */
const CUT_MARK = "…";

type FileTarget = { kind: "workspace"; path: string } | { kind: "unmapped"; reason: string };

/** Git prefixes are filesystem paths: URL/Markdown normalization would change identity. */
function repositoryPrefix(prefix: string): string | null {
  if (prefix === "") return "";
  if (
    prefix.startsWith("/") ||
    prefix.includes("\\") ||
    /[\p{Cc}]/u.test(prefix) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(prefix)
  )
    return null;
  const components = prefix.split("/");
  if (components.at(-1) === "") components.pop();
  if (components.some((part) => part === "" || part === "." || part === "..")) return null;
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

/** Map a tool's session-relative path onto Files' repository-relative paths. */
function fileTarget(path: string, context: ItemContext): FileTarget {
  if (path.startsWith(CUT_MARK)) {
    return {
      kind: "unmapped",
      reason: "Only the end of this path is known, so Files cannot open it.",
    };
  }
  if (path !== path.trim()) {
    return {
      kind: "unmapped",
      reason: "This path cannot be mapped exactly, so Files cannot open it.",
    };
  }
  const prefix = context.filePathPrefix;
  if (prefix == null) {
    return {
      kind: "unmapped",
      reason: "The file's repository location is unknown, so Files cannot open it.",
    };
  }
  const base = repositoryPrefix(prefix);
  const link = classifyMarkdownHref(path, context.workspaceRoots);
  return base != null && link.kind === "workspace"
    ? { kind: "workspace", path: `${base}${link.path}` }
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
  const target = fileTarget(path, context);
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
