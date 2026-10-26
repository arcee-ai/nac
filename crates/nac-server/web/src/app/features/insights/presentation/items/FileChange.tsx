import { useEffect, useId, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CodeDisplayer,
  type CodeDisplayerLine,
  Icon,
  IconName,
  InsightShowFullButton,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import { ItemFileButton } from "@/app/features/insights/presentation/items/ItemFileButton";
import { cn } from "@/app/lib/cn";
import { type CodeToken, highlightDiff } from "@/app/lib/highlight";
import { parseUnifiedDiff, type UnifiedDiff, type UnifiedDiffLine } from "@/app/lib/unifiedDiff";
import { useToolCallContent } from "@/app/services/queries/toolCalls";

/** Rows a diff shows before "Show full". */
const PREVIEW_ROWS = 40;

/** The write and edit results start with the path, so a cut result still names the file. */
const LEADING_PATH = /^\s*\{\s*"path"\s*:\s*("(?:[^"\\]|\\.)*")/u;

interface Change {
  /** As the model wrote it, in full where the summary may be cut. */
  path: string | null;
  /** Null when the result was cut or is not the tools' JSON. */
  diff: UnifiedDiff | null;
}

function leadingPath(output: string): string | null {
  const match = LEADING_PATH.exec(output);
  if (!match) return null;
  try {
    const path: unknown = JSON.parse(match[1]);
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

/** The write and edit tools answer `{ path, old_revision, new_revision, changed_ranges, diff }`. */
function readChange(output: string | null, cut: boolean): Change {
  const text = output ?? "";
  if (!cut) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && "diff" in parsed) {
        const { diff } = parsed;
        const path = "path" in parsed && typeof parsed.path === "string" ? parsed.path : "";
        if (typeof diff === "string") return { path: path || null, diff: parseUnifiedDiff(diff) };
      }
    } catch {
      // Not the tools' JSON, so there is no diff to show.
    }
  }
  return { path: leadingPath(text), diff: null };
}

/** A deleted line keeps its number in the old file, as Files numbers it. */
const displayerLine = (
  line: UnifiedDiffLine,
  tokens: CodeToken[] | undefined,
): CodeDisplayerLine => ({
  kind: line.kind,
  number: line.kind === "delete" ? line.old_lineno : line.new_lineno,
  content: line.content,
  tokens,
  trailing: line.has_trailing_newline ? null : (
    <span className="italic text-basic-muted"> No newline at end of file</span>
  ),
});

function ChangeDiff({ path, diff }: { path: string | null; diff: UnifiedDiff }) {
  const diffId = useId();
  const [expanded, setExpanded] = useState(false);
  const [tokens, setTokens] = useState<Map<UnifiedDiffLine, CodeToken[]> | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    void highlightDiff(path, [diff]).then((result) => {
      if (active) setTokens(result);
    });
    return () => {
      active = false;
    };
  }, [path, diff]);

  const rows = diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  const hunks = useMemo(() => {
    let left = expanded ? rows : PREVIEW_ROWS;
    const shown: CodeDisplayerLine[][] = [];
    for (const hunk of diff.hunks) {
      if (left <= 0) break;
      const lines = hunk.lines.slice(0, left);
      left -= lines.length;
      shown.push(lines.map((line) => displayerLine(line, tokens?.get(line))));
    }
    return shown;
  }, [diff, expanded, rows, tokens]);

  const name = path?.split(/[\\/]/u).pop() || path;
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2">
      <div id={diffId} className="w-full min-w-0">
        <CodeDisplayer aria-label={name ? `Changes to ${name}` : "Changes"} hunks={hunks} />
      </div>
      {rows > PREVIEW_ROWS ? (
        <InsightShowFullButton
          expanded={expanded}
          controls={diffId}
          onClick={() => setExpanded((value) => !value)}
        />
      ) : null}
    </div>
  );
}

/** One button through the retry, so focus stays on it while the change loads again. */
function LoadFailure({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
      {retrying ? null : (
        <p role="alert" className="break-words text-micro text-error-primary">
          Could not load this change.
        </p>
      )}
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.Tertiary}
        content={ButtonContent.IconRight}
        aria-disabled={retrying || undefined}
        className={cn(retrying && "btn-disabled")}
        onClick={retrying ? undefined : onRetry}
      >
        <span className="underline">Retry</span>
        {retrying ? (
          <Loader size={LoaderSize.XSmall} aria-hidden />
        ) : (
          <Icon iconName={IconName.Retry} size={16} aria-hidden />
        )}
      </Button>
    </div>
  );
}

interface FileChangeProps {
  /** `presentation.summary`: as the model wrote it, or cut short. */
  path: string | null;
  callId: string;
  context: ItemContext;
}

/**
 * Whether the element holding `anchor` has been on screen since it mounted.
 * The server reads the session's whole transcript to answer for one call, so
 * a group of many changes asks only for those shown. The anchor has no box of
 * its own: in flow it would add a gap, and out of flow it would not scroll
 * with the column. Without IntersectionObserver every element counts as seen.
 */
function useSeen(anchor: Element | null): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = anchor?.parentElement;
    if (seen || !element) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchor, seen]);
  return seen;
}

/**
 * A finished write or edit: its file button with the lines the call added and
 * removed, then the call's own diff. Both come from the call's result, which
 * loads once the change is on screen.
 */
export function FileChange({ path, callId, context }: FileChangeProps) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const seen = useSeen(anchor);
  const query = useToolCallContent(context.sessionId, callId, seen);
  const { data } = query;
  const change = useMemo(
    () => (data ? readChange(data.output, data.output_truncated) : null),
    [data],
  );
  const diff = change?.diff?.hunks.length ? change.diff : null;
  const filePath = change?.path ?? path;
  // The result lands once the call's batch of parallel calls is done.
  const awaitingResult = data?.output === null;
  // Without data a new fetch starts over as pending, which would swap the
  // retry button out from under focus.
  const failed = !data && (query.isError || (query.errorUpdateCount > 0 && query.isFetching));
  return (
    <>
      <span ref={setAnchor} hidden />
      {filePath ? (
        <ItemFileButton
          path={filePath}
          context={context}
          additions={diff?.additions}
          deletions={diff?.deletions}
        />
      ) : null}
      {(query.isPending || awaitingResult) && !failed ? (
        <div role="status" className="flex items-center gap-2 text-micro text-basic-muted">
          <Loader size={LoaderSize.XSmall} aria-hidden />
          Loading the change…
        </div>
      ) : null}
      {failed ? (
        <LoadFailure retrying={query.isFetching} onRetry={() => void query.refetch()} />
      ) : null}
      {change && !change.diff && !awaitingResult ? (
        <p className="break-words text-micro text-basic-muted">
          This change is too large to show here.
        </p>
      ) : null}
      {diff ? <ChangeDiff path={filePath} diff={diff} /> : null}
    </>
  );
}
