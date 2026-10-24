import type { ActionListButtonStatus, IconName } from "@/app/atoms";
import { actionMeta, entryRow, segmentRow } from "@/app/features/insights/model/labels";
import type { InsightEntry, InsightRow, InsightSegment } from "@/app/features/insights/model/types";
import {
  isProminentAction,
  rowIcon,
  rowStatus,
} from "@/app/features/insights/presentation/actionPresentation";
import {
  sessionTarget,
  type SessionResolver,
} from "@/app/features/insights/presentation/useDelegatedSessions";

export interface RowView {
  icon: IconName;
  label: string;
  meta?: string;
  status: ActionListButtonStatus;
  prominent: boolean;
}

export interface RowSources {
  resolveSession: SessionResolver;
  /** `episode_count` of each thread the snapshot retains, by name. */
  episodeCounts: ReadonlyMap<string, number>;
}

function rowView(row: InsightRow): RowView {
  return {
    icon: rowIcon(row.action),
    label: row.label,
    meta: row.meta ?? undefined,
    status: rowStatus(row.status),
    prominent: isProminentAction(row.action),
  };
}

/** A ready session row reads as the title its delegation record gives it. */
function withSessionTitle(row: InsightRow, title: string | undefined): InsightRow {
  return row.status === "ready" && title ? { ...row, label: title } : row;
}

export function segmentRowView(segment: InsightSegment, sources: RowSources): RowView {
  const session = sources.resolveSession(sessionTarget(segment));
  return rowView(withSessionTitle(segmentRow(segment), session?.title));
}

export function entryRowView(entry: InsightEntry, sources: RowSources): RowView {
  if (entry.kind === "group" && entry.group.segments.length === 1) {
    return segmentRowView(entry.group.segments[0], sources);
  }
  const row = entryRow(entry);
  if (entry.kind === "thread") {
    const count = sources.episodeCounts.get(entry.thread.name);
    return rowView({
      ...row,
      meta: count === undefined ? actionMeta("thread") : `Thread, ${count}`,
    });
  }
  if (entry.kind === "session") {
    return rowView(withSessionTitle(row, sources.resolveSession(entry.rowKey)?.title));
  }
  return rowView(row);
}
