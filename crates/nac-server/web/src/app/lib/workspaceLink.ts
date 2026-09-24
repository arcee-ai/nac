/**
 * How a markdown href should be handled in the chat: open elsewhere, open in
 * the Files panel, or swallow the click so HashRouter does not dump the user
 * on the homescreen.
 */
export type MarkdownHrefKind =
  | { kind: "external"; href: string }
  | { kind: "workspace"; path: string }
  | { kind: "blocked" };

const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp|file)$/i;
const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/;
const EXTERNAL_PROTOCOL = /^(https?|mailto|ircs?|xmpp):/i;

/**
 * `react-markdown`'s default transform drops `file:` (and Windows drive
 * letters), which is exactly what agents emit for workspace files. Keep those,
 * still reject anything else with a scheme (`javascript:` etc.).
 */
export function markdownUrlTransform(value: string): string {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (WINDOWS_PATH.test(url)) return url;
  const colon = url.indexOf(":");
  if (colon === -1 || SAFE_PROTOCOL.test(url.slice(0, colon))) return url;
  return "";
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripRoot(path: string, root: string | null | undefined): string | null {
  if (!root) return null;
  const base = normalizeSlashes(root).replace(/\/+$/, "");
  if (!base) return null;
  if (path === base) return "";
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  return null;
}

/**
 * Turn a markdown href into a workspace-relative path the Files panel can open,
 * or say it is an ordinary external link / unresolvable file reference.
 */
export function classifyMarkdownHref(
  href: string | undefined,
  hostRoots: Array<string | null | undefined> = [],
): MarkdownHrefKind {
  const raw = (href ?? "").trim();
  if (!raw || raw.startsWith("#")) return { kind: "blocked" };
  if (EXTERNAL_PROTOCOL.test(raw)) return { kind: "external", href: raw };
  // Anything else with a scheme (`javascript:`, `data:`, …) is not a file path.
  // Windows drive letters (`C:\…`) are the exception and are handled below.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^file:/i.test(raw)) {
    return { kind: "blocked" };
  }

  let path = raw;

  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
      // `file:///C:/Users/...` → pathname `/C:/Users/...`
      if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
    } catch {
      path = path.replace(/^file:\/\//i, "").replace(/^localhost/i, "");
    }
  }

  path = normalizeSlashes(path);

  for (const root of hostRoots) {
    const relative = stripRoot(path, root);
    if (relative != null) {
      path = relative;
      break;
    }
  }

  // Still absolute after stripping: cannot map onto the panel without guessing.
  if (path.startsWith("/") || WINDOWS_PATH.test(path)) {
    return { kind: "blocked" };
  }

  path = path.replace(/^\.\//, "");
  if (!path || path === ".") return { kind: "blocked" };
  if (path.split("/").includes("..")) return { kind: "blocked" };
  if (path.includes("://")) return { kind: "blocked" };

  return { kind: "workspace", path };
}

/** Workspace-relative path the Files panel can open, or null if it cannot. */
export function toWorkspaceRelativePath(
  raw: string | null | undefined,
  hostRoots: Array<string | null | undefined> = [],
): string | null {
  const kind = classifyMarkdownHref(raw ?? undefined, hostRoots);
  return kind.kind === "workspace" ? kind.path : null;
}
