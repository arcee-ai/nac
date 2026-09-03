import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";

import SegmentDetailRow, {
  type SegmentDetailItem,
} from "@/app/components/inspector/agent-segments/SegmentDetailRow";
import type { SidebarBoxContent } from "@/app/components/inspector/agent-segments/SegmentDetailBox";
import { useActionSegmentScroll, useSelectedActionSegmentKey } from "@/app/lib/actionExpand";
import {
  configForSegment,
  toolSegmentFailed,
  ToolCallLabelState,
  type AgentSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { cn } from "@/app/lib/cn";
import {
  STICK_TOLERANCE_PX,
  distanceFromBottom,
  scrollToBottomInstantly,
} from "@/app/lib/scroll";
import { sessionIdFromPath } from "@/app/lib/routes";
import {
  GLOB_EMPTY_RESULT_LABEL,
  isEmptyGlobResultPreview,
} from "@/app/lib/toolPresentation";
import { toWorkspaceRelativePath } from "@/app/lib/workspaceLink";
import { queryKeys } from "@/app/services/queries";
import type { SessionSnapshotResponse } from "@/app/types/api";
import "./agent-segments.css";

function outputAccent(segment: AgentSegment): "error" | undefined {
  if (segment.kind !== "tool") return undefined;
  if (segment.presentation.status === "error") return "error";
  if (segment.presentation.resultPreview?.startsWith("Error:")) return "error";
  return undefined;
}

function boxesForSegment(
  segment: AgentSegment,
  hostRoots: Array<string | null | undefined>,
): {
  boxes: SidebarBoxContent[];
  copyText: string;
} {
  if (segment.kind === "thinking") {
    const content = segment.text.trim() || "No reasoning content";
    return {
      boxes: [{ kind: "markdown", key: `${segment.key}-body`, content }],
      copyText: segment.text,
    };
  }
  if (
    segment.presentation.name === "read" ||
    segment.presentation.name === "write" ||
    segment.presentation.name === "edit"
  ) {
    const files = readFileBoxes(segment, hostRoots);
    if (files) return files;
  }
  if (segment.presentation.name === "glob") {
    const glob = globFileBoxes(segment, hostRoots);
    if (glob) return glob;
  }
  const boxes: SidebarBoxContent[] = [];
  if (segment.presentation.summary) {
    boxes.push({
      kind: "code",
      key: `${segment.key}-input`,
      content: segment.presentation.summary,
      accent:
        segment.presentation.name === "exec_command" ||
        segment.presentation.name === "glob"
          ? "info"
          : undefined,
    });
  }
  if (segment.presentation.resultPreview) {
    boxes.push({
      kind: "markdown",
      key: `${segment.key}-output`,
      content: segment.presentation.resultPreview,
      accent: outputAccent(segment),
    });
  }
  return {
    boxes,
    copyText: [
      segment.presentation.summary
        ? `Input:\n${segment.presentation.summary}`
        : "",
      segment.presentation.resultPreview
        ? `Output:\n${segment.presentation.resultPreview}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function readFileBoxes(
  segment: Extract<AgentSegment, { kind: "tool" }>,
  hostRoots: Array<string | null | undefined>,
): { boxes: SidebarBoxContent[]; copyText: string } | null {
  const summary = segment.presentation.summary;
  const preview = segment.presentation.resultPreview;
  const path =
    toWorkspaceRelativePath(summary, hostRoots) ??
    toWorkspaceRelativePath(preview, hostRoots);
  if (!path) return null;
  const boxes: SidebarBoxContent[] = [
    { kind: "file", key: `${segment.key}-file`, path },
  ];
  if (preview && toWorkspaceRelativePath(preview, hostRoots) == null) {
    boxes.push({
      kind: "markdown",
      key: `${segment.key}-output`,
      content: preview,
      accent: outputAccent(segment),
    });
  }
  return { boxes, copyText: path };
}

const MAX_GLOB_FILES = 3;

interface GlobEntry {
  kind: "file" | "directory";
  path: string;
}

function unescapeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"');
  }
}

function parseGlobEntries(preview: string | null): GlobEntry[] {
  if (!preview) return [];
  try {
    const parsed = JSON.parse(preview) as { entries?: unknown };
    if (Array.isArray(parsed.entries)) {
      return parsed.entries.flatMap((entry) => globEntryFromUnknown(entry));
    }
  } catch {
    // Preview is a bounded snippet, so the JSON is often truncated.
  }
  const entries: GlobEntry[] = [];
  const objectRe = /\{[^{}]+\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectRe.exec(preview)) !== null) {
    entries.push(...globEntryFromUnknown(parseLooseGlobObject(match[0])));
  }
  return entries;
}

function parseLooseGlobObject(chunk: string): unknown {
  const pathMatch = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(chunk);
  const kindMatch = /"kind"\s*:\s*"(directory|file)"/.exec(chunk);
  if (!pathMatch) return null;
  return {
    path: unescapeJsonString(pathMatch[1]),
    kind: kindMatch?.[1] ?? "file",
  };
}

function globEntryFromUnknown(entry: unknown): GlobEntry[] {
  if (!entry || typeof entry !== "object") return [];
  const path =
    "path" in entry && typeof entry.path === "string" ? entry.path : "";
  if (!path) return [];
  const kind =
    "kind" in entry && entry.kind === "directory" ? "directory" : "file";
  return [{ kind, path }];
}

function globQueryBox(
  segment: Extract<AgentSegment, { kind: "tool" }>,
): SidebarBoxContent | null {
  if (!segment.presentation.summary) return null;
  return {
    kind: "code",
    key: `${segment.key}-input`,
    content: segment.presentation.summary,
    accent: "info",
  };
}

function globFileBoxes(
  segment: Extract<AgentSegment, { kind: "tool" }>,
  hostRoots: Array<string | null | undefined>,
): { boxes: SidebarBoxContent[]; copyText: string } | null {
  const query = globQueryBox(segment);
  if (isEmptyGlobResultPreview(segment.presentation.resultPreview)) {
    const boxes: SidebarBoxContent[] = [];
    if (query) boxes.push(query);
    boxes.push({
      kind: "muted",
      key: `${segment.key}-empty`,
      content: GLOB_EMPTY_RESULT_LABEL,
    });
    return {
      boxes,
      copyText: [
        query ? `Query:\n${segment.presentation.summary}` : "",
        GLOB_EMPTY_RESULT_LABEL,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  const resolved = parseGlobEntries(segment.presentation.resultPreview).flatMap(
    (entry) => {
      const path =
        toWorkspaceRelativePath(entry.path, hostRoots) ??
        (entry.path.startsWith("/") ? null : entry.path.replace(/^\.\//, ""));
      return path ? [{ kind: entry.kind, path }] : [];
    },
  );
  if (resolved.length === 0) return null;
  const shown = resolved.slice(0, MAX_GLOB_FILES);
  const more = resolved.length - shown.length;
  const boxes: SidebarBoxContent[] = [];
  if (query) boxes.push(query);
  boxes.push(
    ...shown.map((entry, index) => ({
      kind: "file" as const,
      key: `${segment.key}-file-${index}`,
      path: entry.path,
      directory: entry.kind === "directory",
    })),
  );
  if (more > 0) {
    boxes.push({ kind: "more", key: `${segment.key}-more`, count: more });
  }
  return {
    boxes,
    copyText: [
      segment.presentation.summary
        ? `Query:\n${segment.presentation.summary}`
        : "",
      resolved.map((entry) => entry.path).join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function itemsFromGroup(
  group: AgentToolsGroup,
  hostRoots: Array<string | null | undefined>,
): SegmentDetailItem[] {
  return group.segments.map((segment) => {
    const { boxes, copyText } = boxesForSegment(segment, hostRoots);
    const live =
      segment.kind === "thinking"
        ? segment.streaming
        : segment.presentation.status === "pending" ||
          segment.presentation.status === "running";
    return {
      key: segment.key,
      config: configForSegment(segment),
      state: live ? ToolCallLabelState.Active : ToolCallLabelState.Default,
      durationMs: segment.kind === "thinking" ? segment.durationMs : null,
      copyText,
      boxes,
      failed: toolSegmentFailed(segment),
    };
  });
}

export function SegmentDetailList({
  group,
  className,
}: {
  group: AgentToolsGroup;
  className?: string;
}) {
  const location = useLocation();
  const client = useQueryClient();
  const sessionId = sessionIdFromPath(location.pathname);
  const snapshot = sessionId
    ? client.getQueryData<SessionSnapshotResponse>(
        queryKeys.sessionSnapshot(sessionId),
      )
    : undefined;
  const hostRoots = useMemo(
    () => [
      snapshot?.workspace?.host_root,
      snapshot?.metadata.workspace_host_path,
      snapshot?.metadata.cwd,
    ],
    [
      snapshot?.workspace?.host_root,
      snapshot?.metadata.workspace_host_path,
      snapshot?.metadata.cwd,
    ],
  );
  const items = useMemo(
    () => itemsFromGroup(group, hostRoots),
    [group, hostRoots],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const scrollTo = useActionSegmentScroll();
  const selectedKey = useSelectedActionSegmentKey();
  const last = items[items.length - 1];
  const followSeed = `${items.length}:${last?.key ?? ""}:${last?.copyText.length ?? 0}:${group.inProgress}`;

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [followSeed]);

  useEffect(() => {
    if (!scrollTo) return;
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector(
      `[data-segment-key="${CSS.escape(scrollTo.key)}"]`,
    );
    if (!(el instanceof HTMLElement)) return;
    stuckRef.current = false;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const marginTop =
      Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const top =
      root.scrollTop +
      el.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      marginTop;
    root.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [scrollTo]);

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full px-4 label-small text-basic-tertiary",
          className,
        )}
      >
        No reasoning or tool calls
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className={cn(className, "flex flex-col gap-2")}
      onScroll={() => {
        const element = rootRef.current;
        if (element) {
          stuckRef.current = distanceFromBottom(element) <= STICK_TOLERANCE_PX;
        }
      }}
    >
      {items.map((item, index) => (
        <SegmentDetailRow
          key={item.key}
          item={item}
          isLast={index === items.length - 1}
          animateConnector={group.inProgress && index === items.length - 2}
          highlighted={selectedKey === item.key}
        />
      ))}
    </div>
  );
}
