import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { Icon } from "../../atoms/icon.js";
import { Loader, LoaderSize } from "../../atoms/loader.js";
import { Tooltip } from "../../atoms/tooltip.js";
import { useSnapshot, loadSnapshot } from "../../store/sessionsStore.js";
import { api } from "../../services/api.js";

const { useState, useCallback, useEffect } = React;

const MAX_FILES = 80;
// git rename/copy statuses have no meaningful single-file textual diff.
const isRenameOrCopy = (status) => /^[RC]/.test((status || "").trim());
const unsupportedLabel = (status) => {
  const s = (status || "").trim().toUpperCase();
  if (s.startsWith("C")) return "copy unsupported";
  if (s.startsWith("R")) return "rename unsupported";
  return "unsupported";
};

const STATUS_LABEL = {
  M: "text-danger-primary",
  A: "text-success-primary",
  D: "text-error-primary",
  R: "text-info-primary",
  "?": "text-basic-muted",
};

const statusColor = (s) => STATUS_LABEL[(s || "").trim()[0]] || "text-basic-secondary";

// Backend emits kind "insert" | "delete" | "context". Added/deleted highlight
// colors are copied verbatim from the legacy UI (per request); everything else
// uses our design tokens.
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

function DiffState({ tone, children }) {
  return html`<div
    class=${cn(
      "rounded-md px-3 py-2 font-mono text-micro",
      tone === "error"
        ? "text-error-primary bg-error-tertiary border border-error-muted"
        : "text-basic-muted bg-elevation-level-0-5",
    )}
  >
    ${children}
  </div>`;
}

function DiffLine({ line }) {
  const kind = line.kind || "context";
  const isAdd = kind === "insert";
  const isDel = kind === "delete";
  const marker = isAdd ? "+" : isDel ? "-" : " ";
  const bg = isAdd ? HL_ADD : isDel ? HL_DEL : undefined;
  const markerClass = isAdd ? "text-success-primary" : isDel ? "text-error-primary" : "text-basic-muted";
  return html`<tr class="border-t border-white/[0.05]" style=${bg ? { background: bg } : undefined}>
    <td class=${GUTTER} style=${GUTTER_W}>${line.old_lineno ?? ""}</td>
    <td class=${cn(GUTTER, "border-r border-white/[0.05]")} style=${GUTTER_W}>${line.new_lineno ?? ""}</td>
    <td class=${cn(MARKER, markerClass)} style=${MARKER_W}>${marker === " " ? "\u00a0" : marker}</td>
    <td class=${CODE} style=${CODE_W}>
      ${line.content}${line.has_trailing_newline === false
        ? html`<span class="italic text-basic-muted"> No newline at end of file</span>`
        : null}
    </td>
  </tr>`;
}

function DiffHunk({ hunk }) {
  const label = `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@${hunk.function_context ? ` ${hunk.function_context}` : ""}`;
  return html`<tbody>
    <tr class="font-semibold text-info-primary" style=${{ background: HL_HUNK }}>
      <td class=${GUTTER} style=${GUTTER_W}>${hunk.old_start}</td>
      <td class=${GUTTER} style=${GUTTER_W}>${hunk.new_start}</td>
      <td class=${MARKER} style=${MARKER_W}>@@</td>
      <td class=${cn(CELL, "whitespace-pre")} style=${CODE_W}>${label}</td>
    </tr>
    ${(hunk.lines || []).map((l, li) => html`<${DiffLine} key=${li} line=${l} />`)}
  </tbody>`;
}

function DiffSection({ section }) {
  const stage = section.stage || "diff";
  const status = section.status || "changed";
  const flags = [
    section.binary ? "binary" : null,
    section.too_large ? "too large" : null,
    section.truncated ? "truncated" : null,
  ].filter(Boolean);
  const meta = [`${section.additions ?? 0} additions`, `${section.deletions ?? 0} deletions`, ...flags];
  const hunks = section.hunks || [];
  const renderTable = !section.error && !section.binary && !section.too_large;

  return html`<div class="flex flex-col gap-2 min-w-0">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-micro">
      <div class="flex items-center gap-2 min-w-0">
        <span class="uppercase font-semibold text-success-primary">${stage}</span>
        <span class="text-basic-muted">${status}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-basic-muted">
        ${meta.map((m, i) => html`<span key=${i}>${m}</span>`)}
      </div>
    </div>
    ${section.error ? html`<${DiffState} tone="error">Error: ${section.error}</${DiffState}>` : null}
    ${section.binary
      ? html`<${DiffState}>Binary or non-UTF-8 content; inline hunks are unavailable.</${DiffState}>`
      : null}
    ${section.too_large ? html`<${DiffState}>File is too large for inline diff rendering.</${DiffState}>` : null}
    ${section.truncated
      ? html`<div class="rounded-md px-3 py-2 font-mono text-micro text-basic-primary border border-secondary">Diff was truncated by the backend.</div>`
      : null}
    ${renderTable && hunks.length > 0
      ? html`<div class="overflow-auto rounded-md border border-secondary bg-elevation-level-0-5">
          <table class="w-full border-collapse font-mono text-micro leading-relaxed" style=${{ minWidth: "620px" }}>
            ${hunks.map((h, hi) => html`<${DiffHunk} key=${hi} hunk=${h} />`)}
          </table>
        </div>`
      : renderTable
        ? html`<${DiffState}>No hunks for this section.</${DiffState}>`
        : null}
  </div>`;
}

function DiffBody({ diff }) {
  const path = diff.path || "";
  const oldPath = diff.old_path && diff.old_path !== path ? diff.old_path : null;
  const title = oldPath ? `${oldPath} -> ${path}` : path;
  const sections = diff.sections || [];
  return html`<div class="flex flex-col gap-2 p-2">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-micro font-semibold text-basic-primary">
      <span class="min-w-0 break-all">${title}</span>
      <span class="text-basic-muted">${sections.length} section${sections.length === 1 ? "" : "s"}</span>
    </div>
    ${diff.error ? html`<${DiffState} tone="error">${diff.error}</${DiffState}>` : null}
    ${sections.length === 0 && !diff.error
      ? html`<${DiffState}>No diff sections returned.</${DiffState}>`
      : sections.map(
          (sec, si) => html`<div key=${si} class=${si > 0 ? "border-t border-white/[0.05] pt-2" : ""}>
            <${DiffSection} section=${sec} />
          </div>`,
        )}
  </div>`;
}

function FileRow({ id, file }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const unsupported = isRenameOrCopy(file.status);

  const toggle = useCallback(async () => {
    if (unsupported) return;
    const next = !open;
    setOpen(next); // re-click closes the diff
    if (next && !diff && !loading) {
      setLoading(true);
      setError("");
      try {
        setDiff(await api.getWorkspaceDiff(id, file.path, { stage: "all", context: 3 }));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  }, [open, diff, loading, id, file.path, unsupported]);

  const header = html`<button
    type="button"
    class=${cn("w-full flex items-center gap-2 p-2 text-left", unsupported && "opacity-60 cursor-not-allowed")}
    onClick=${toggle}
    disabled=${unsupported}
  >
    <${Icon}
      name="down"
      className=${cn("transition-transform shrink-0", unsupported ? "opacity-0" : open ? "rotate-0" : "-rotate-90")}
    />
    <span class=${cn("font-mono text-micro shrink-0 w-4 text-center", statusColor(file.status))}>${(file.status || "?").trim()[0]}</span>
    <span class="label-small text-basic-primary truncate flex-grow font-mono">${file.path}</span>
    ${file.additions != null ? html`<span class="text-micro text-success-primary shrink-0">+${file.additions}</span>` : null}
    ${file.deletions != null ? html`<span class="text-micro text-error-primary shrink-0">-${file.deletions}</span>` : null}
    ${unsupported ? html`<span class="text-micro text-basic-muted shrink-0">${unsupportedLabel(file.status)}</span>` : null}
  </button>`;

  return html`<div class="rounded-lg border border-secondary bg-elevation-level-1 overflow-hidden">
    ${unsupported
      ? html`<${Tooltip} title="Rename/copy has no single-file diff" position="top-center">${header}</${Tooltip}>`
      : header}
    ${open
      ? html`<div class="border-t border-secondary max-h-[420px] overflow-auto">
          ${loading ? html`<div class="p-3 flex items-center gap-2 text-basic-muted text-micro"><${Loader} size=${LoaderSize.Small} /> Loading diff…</div>` : null}
          ${error ? html`<div class="p-3 text-error-primary text-micro">${error}</div>` : null}
          ${diff ? html`<${DiffBody} diff=${diff} />` : null}
        </div>`
      : null}
  </div>`;
}

// Workspace tab: repo/branch summary + changed files with on-demand diff.
export function WorkspaceView({ id }) {
  const snap = useSnapshot(id);
  const ws = (snap && snap.workspace) || {};
  const allFiles = ws.changed_files || [];
  const files = allFiles.slice(0, MAX_FILES);
  const hiddenCount = allFiles.length - files.length;

  // Refresh the snapshot (and its workspace diff stats) when this tab opens.
  useEffect(() => {
    if (id) loadSnapshot(id);
  }, [id]);

  if (!snap) return html`<div class="p-6 text-basic-muted label-small">Loading…</div>`;

  return html`<div class="h-full overflow-auto p-4 flex flex-col gap-3 [&>*]:shrink-0">
    <div class="rounded-xl border border-secondary bg-elevation-level-1 p-3 flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <${Icon} name="folder" />
        <span class="label-small text-basic-primary truncate font-mono">${ws.workspace_display || "workspace"}</span>
      </div>
      <div class="flex items-center gap-3 text-micro text-basic-muted">
        ${ws.repo_label ? html`<span>${ws.repo_label}</span>` : null}
        ${ws.branch ? html`<span class="flex items-center gap-1"><${Icon} name="flow" size=${14} /> ${ws.branch}</span>` : null}
        <span class="text-success-primary">+${ws.total_additions || 0}</span>
        <span class="text-error-primary">-${ws.total_deletions || 0}</span>
      </div>
    </div>

    ${ws.error ? html`<div class="text-error-primary label-small">${ws.error}</div>` : null}

    ${files.length === 0 && !ws.error
      ? html`<div class="text-basic-muted label-small px-1">No changes in the workspace.</div>`
      : files.map((f) => html`<${FileRow} key=${f.path} id=${id} file=${f} />`)}

    ${hiddenCount > 0
      ? html`<div class="text-micro text-basic-muted px-1">Showing first ${MAX_FILES} of ${allFiles.length} changed files (${hiddenCount} more hidden).</div>`
      : null}
  </div>`;
}
