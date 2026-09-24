import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { SegmentDetailBoxContent } from "@/app/components/inspector/agent-segments/SegmentDetailBox";
import SegmentDetailRow, {
  type SegmentDetailItem,
} from "@/app/components/inspector/agent-segments/SegmentDetailRow";
import {
  configForSegment,
  segmentIsLive,
  toolSegmentFailed,
  type AgentSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { useActionSegmentScroll, useSelectedActionSegmentKey } from "@/app/lib/actionExpand";
import { cn } from "@/app/lib/cn";
import { formatSeconds } from "@/app/lib/format";
import { STICK_TOLERANCE_PX, distanceFromBottom, scrollToBottomInstantly } from "@/app/lib/scroll";
import { GLOB_EMPTY_RESULT_LABEL, isEmptyGlobResultPreview } from "@/app/lib/toolPresentation";
import { toWorkspaceRelativePath } from "@/app/lib/workspaceLink";
import "./agent-segments.css";

function outputAccent(segment: AgentSegment): "error" | undefined {
  if (segment.kind !== "tool") return undefined;
  if (toolSegmentFailed(segment)) return "error";
  if (segment.presentation.resultPreview?.startsWith("Error:")) return "error";
  return undefined;
}

function detailForSegment(
  segment: AgentSegment,
  hostRoots: Array<string | null | undefined>,
): {
  boxes: SegmentDetailBoxContent[];
  copyText: string;
} {
  if (segment.kind === "thinking") {
    return {
      boxes: [{ kind: "markdown", key: `${segment.key}-body`, content: segment.text }],
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

  const boxes: SegmentDetailBoxContent[] = [];
  if (segment.presentation.summary) {
    boxes.push({
      kind: "code",
      key: `${segment.key}-input`,
      content: segment.presentation.summary,
      accent:
        segment.presentation.name === "exec_command" || segment.presentation.name === "glob"
          ? "info"
          : undefined,
    });
  }
  if (segment.presentation.resultPreview) {
    boxes.push({
      kind: segment.presentation.name === "exec_command" ? "code" : "markdown",
      key: `${segment.key}-output`,
      content: segment.presentation.resultPreview,
      accent: outputAccent(segment),
    });
  }
  return {
    boxes,
    copyText: [
      segment.presentation.summary ? `Input:\n${segment.presentation.summary}` : "",
      segment.presentation.resultPreview ? `Output:\n${segment.presentation.resultPreview}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function readFileBoxes(
  segment: Extract<AgentSegment, { kind: "tool" }>,
  hostRoots: Array<string | null | undefined>,
): { boxes: SegmentDetailBoxContent[]; copyText: string } | null {
  const summary = segment.presentation.summary;
  const preview = segment.presentation.resultPreview;
  const path =
    toWorkspaceRelativePath(summary, hostRoots) ?? toWorkspaceRelativePath(preview, hostRoots);
  if (!path) return null;

  const boxes: SegmentDetailBoxContent[] = [{ kind: "file", key: `${segment.key}-file`, path }];
  const previewPath = toWorkspaceRelativePath(preview, hostRoots);
  if (preview && previewPath !== path) {
    boxes.push({
      kind: "markdown",
      key: `${segment.key}-output`,
      content: preview,
      accent: outputAccent(segment),
    });
  }
  return {
    boxes,
    copyText: [path, previewPath === path ? "" : (preview ?? "")].filter(Boolean).join("\n\n"),
  };
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

function globEntryFromUnknown(entry: unknown): GlobEntry[] {
  if (!entry || typeof entry !== "object") return [];
  const path = "path" in entry && typeof entry.path === "string" ? entry.path : "";
  if (!path) return [];
  const kind = "kind" in entry && entry.kind === "directory" ? "directory" : "file";
  return [{ kind, path }];
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

function parseGlobEntries(preview: string | null): GlobEntry[] {
  if (!preview) return [];
  try {
    const parsed = JSON.parse(preview) as { entries?: unknown };
    if (Array.isArray(parsed.entries)) {
      return parsed.entries.flatMap((entry) => globEntryFromUnknown(entry));
    }
  } catch {
    // Durable event previews are bounded, so fall through to complete objects.
  }

  const entries: GlobEntry[] = [];
  const objectRe = /\{[^{}]+\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectRe.exec(preview)) !== null) {
    entries.push(...globEntryFromUnknown(parseLooseGlobObject(match[0])));
  }
  return entries;
}

function globQueryBox(
  segment: Extract<AgentSegment, { kind: "tool" }>,
): SegmentDetailBoxContent | null {
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
): { boxes: SegmentDetailBoxContent[]; copyText: string } | null {
  const query = globQueryBox(segment);
  if (isEmptyGlobResultPreview(segment.presentation.resultPreview)) {
    const boxes: SegmentDetailBoxContent[] = [];
    if (query) boxes.push(query);
    boxes.push({
      kind: "muted",
      key: `${segment.key}-empty`,
      content: GLOB_EMPTY_RESULT_LABEL,
    });
    return {
      boxes,
      copyText: [query ? `Query:\n${segment.presentation.summary}` : "", GLOB_EMPTY_RESULT_LABEL]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  const resolved = parseGlobEntries(segment.presentation.resultPreview).flatMap((entry) => {
    const path =
      toWorkspaceRelativePath(entry.path, hostRoots) ??
      (entry.path.startsWith("/") ? null : entry.path.replace(/^\.\//, ""));
    return path ? [{ kind: entry.kind, path }] : [];
  });
  if (resolved.length === 0) return null;

  const shown = resolved.slice(0, MAX_GLOB_FILES);
  const boxes: SegmentDetailBoxContent[] = [];
  if (query) boxes.push(query);
  boxes.push(
    ...shown.map((entry, index) => ({
      kind: "file" as const,
      key: `${segment.key}-file-${index}`,
      path: entry.path,
      directory: entry.kind === "directory",
    })),
  );
  if (resolved.length > shown.length) {
    boxes.push({
      kind: "more",
      key: `${segment.key}-more`,
      count: resolved.length - shown.length,
    });
  }
  return {
    boxes,
    copyText: [
      query ? `Query:\n${segment.presentation.summary}` : "",
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
    const config = configForSegment(segment);
    const { boxes, copyText } = detailForSegment(segment, hostRoots);
    if (segment.kind === "thinking") {
      const duration = formatSeconds(segment.durationMs);
      return {
        key: segment.key,
        config,
        label: segment.streaming ? config.inProgressLabel : config.regularLabel,
        statusLabel: segment.streaming ? "Thinking" : duration || "Complete",
        live: segment.streaming,
        failed: false,
        copyText,
        boxes,
      };
    }
    return {
      key: segment.key,
      config,
      label: segmentIsLive(segment) ? config.inProgressLabel : segment.presentation.label,
      statusLabel: segment.presentation.statusLabel,
      live: segmentIsLive(segment),
      failed: toolSegmentFailed(segment),
      copyText,
      boxes,
    };
  });
}

export function SegmentDetailList({
  group,
  className,
  hostRoots = [],
}: {
  group: AgentToolsGroup;
  className?: string;
  hostRoots?: Array<string | null | undefined>;
}) {
  const items = useMemo(() => itemsFromGroup(group, hostRoots), [group, hostRoots]);
  const rootRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const scrollTo = useActionSegmentScroll();
  const selectedKey = useSelectedActionSegmentKey();
  const last = items[items.length - 1];
  const followSeed = `${items.length}:${last?.key ?? ""}:${last?.copyText.length ?? 0}:${group.inProgress}`;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !stuckRef.current) return;
    scrollToBottomInstantly(root);
  }, [followSeed]);

  useEffect(() => {
    if (!scrollTo) return;
    const root = rootRef.current;
    if (!root) return;
    const element = Array.from(root.querySelectorAll<HTMLElement>("[data-segment-key]")).find(
      (candidate) => candidate.dataset.segmentKey === scrollTo.key,
    );
    if (!element) return;
    stuckRef.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const marginTop = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const top =
      root.scrollTop +
      element.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      marginTop;
    root.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [scrollTo]);

  if (items.length === 0) {
    return (
      <div className={cn("label-small text-basic-muted", className)}>
        No reasoning or tool calls
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className={className}
      onScroll={() => {
        const root = rootRef.current;
        if (root) stuckRef.current = distanceFromBottom(root) <= STICK_TOLERANCE_PX;
      }}
    >
      {items.map((item, index) => (
        <SegmentDetailRow
          key={item.key}
          item={item}
          isLast={index === items.length - 1}
          highlighted={selectedKey === item.key}
        />
      ))}
    </div>
  );
}
