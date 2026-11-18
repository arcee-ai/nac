import { useQueryClient } from "@tanstack/react-query";
import { memo, useState } from "react";
import { useHref, useLinkClickHandler } from "react-router-dom";

import { SubagentCardStatus, SubagentTranscriptCard } from "@/app/atoms";
import { ToolCallDetail } from "@/app/components/inspector/ToolCallDetail";
import { cardStatus, type CardStatus } from "@/app/features/delegation/presentation/cardStatus";
import type { InsightSessionEntry } from "@/app/features/insights/model/types";
import { useTranscriptSessionId } from "@/app/features/insights/transcript/transcriptTurns";
import { useInsightsNavigation } from "@/app/features/insights/useInsightsNavigation";
import { useSessionBehaviorIconVisible } from "@/app/features/ui-policy/useSessionBehaviorIconVisible";
import { routes } from "@/app/lib/routes";
import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";
import { queryKeys } from "@/app/services/queries/keys";
import type { ManagedOrchestratorRecord, TraditionalChildRecord } from "@/app/types/api";

type LaunchedRecord = TraditionalChildRecord | ManagedOrchestratorRecord;

const LINEAGE = {
  "spawn-agent": "traditional-child",
  "spawn-orchestrator": "managed-orchestrator",
} as const;

function recordId(record: LaunchedRecord): string {
  return "child_session_id" in record ? record.child_session_id : record.orchestrator_session_id;
}

function launchedRecord(
  records: readonly LaunchedRecord[] | undefined,
  spawnedId: string | undefined,
): LaunchedRecord | undefined {
  return spawnedId ? records?.find((record) => recordId(record) === spawnedId) : undefined;
}

/**
 * The parent's delegated sessions of the launched kind. They are fetched while
 * the launch runs, then until they list the session it reports, and then only
 * while that session runs, so a long transcript of settled cards polls nothing.
 * A launch can settle before a list that has its session arrives, and on a
 * phone nothing else refreshes that list. A failed list ends the wait; the
 * gate reads the cache, so it sees the failure only because the card reads
 * `failed` and re-renders with it.
 */
function useLaunchedRecords(entry: InsightSessionEntry, parentId: string | null) {
  const client = useQueryClient();
  const agent = entry.action === "spawn-agent";
  const parent = parentId ?? "";
  const known = client.getQueryState<LaunchedRecord[]>(
    agent ? queryKeys.traditionalChildren(parent) : queryKeys.managedOrchestrators(parent),
  );
  const unsettled = entry.status === "running" || entry.status === "pending";
  const spawnedId = entry.presentation.spawnedSessionId;
  const record = launchedRecord(known?.data, spawnedId);
  const live =
    parentId !== null &&
    (unsettled ||
      (known?.status !== "error" &&
        (known?.data === undefined || (spawnedId !== undefined && record === undefined))) ||
      record?.status === "running");
  const agents = useTraditionalChildren(parent, agent && live);
  const orchestrators = useManagedOrchestrators(parent, !agent && live);
  const query = agent ? agents : orchestrators;
  return { records: query.data, failed: query.isError };
}

interface CardState extends CardStatus {
  title: string;
  /** The launch resolved to one of the parent's own sessions, which may be opened. */
  sessionId: string | null;
}

/** A call that waits for approval or did not go through, as Insights shows it. */
function callStatus(entry: InsightSessionEntry): CardStatus | null {
  const label =
    entry.action === "spawn-agent" ? entry.presentation.label : entry.presentation.statusLabel;
  if (
    entry.action === "spawn-agent" &&
    entry.presentation.status === "running" &&
    !entry.presentation.delegationIntent
  )
    return { status: SubagentCardStatus.Pending, label };
  if (entry.presentation.status === "pending" || entry.status === "pending")
    return {
      status:
        entry.action === "spawn-agent" ? SubagentCardStatus.Pending : SubagentCardStatus.Running,
      label,
    };
  if (entry.status === "failed") return { status: SubagentCardStatus.Failed, label };
  return null;
}

/**
 * The launch reports the session it started, but the model can put anything
 * in that report, so only a session the parent really has is shown as such.
 * Only a list that arrived can say the session is missing: while there is none
 * (loading, failed, or never fetched without NAC orchestration) or the latest
 * fetch failed, the launch shows as it reported itself, with nothing to open.
 * A call that continues a session names it before it runs, so a session the
 * parent has does not mean the call went through.
 */
function cardState(
  entry: InsightSessionEntry,
  records: readonly LaunchedRecord[] | undefined,
  failed: boolean,
): CardState {
  const record = launchedRecord(records, entry.presentation.spawnedSessionId);
  const own = callStatus(entry);
  if (record) {
    return {
      ...(own ?? cardStatus(record.status)),
      // Inventory proves ownership, but its raw description is not a sanitized preview.
      title:
        entry.action === "spawn-agent" ? entry.title : record.description.trim() || entry.title,
      sessionId: recordId(record),
    };
  }
  const { title } = entry;
  if (own) return { ...own, title, sessionId: null };
  if (entry.status === "running")
    return { status: SubagentCardStatus.Running, title, sessionId: null };
  if (records === undefined || failed) {
    return { status: SubagentCardStatus.Ready, title, sessionId: null };
  }
  return { status: SubagentCardStatus.NotFound, title, sessionId: null };
}

/**
 * A session the turn launched, with its live status. Opens it in Subagents and
 * links to its own page; without `interactive` it is a plain summary.
 */
export const TranscriptSessionCard = memo(function TranscriptSessionCard({
  entry,
  interactive,
}: {
  entry: InsightSessionEntry;
  interactive: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const parentId = useTranscriptSessionId();
  const { records, failed } = useLaunchedRecords(entry, parentId);
  const state = cardState(entry, records, failed);
  const requestStatus = callStatus(entry);
  const showBehaviorIcon = useSessionBehaviorIconVisible();
  const { openSubagent } = useInsightsNavigation();
  const sessionRoute = routes.session(state.sessionId ?? "");
  const sessionHref = useHref(sessionRoute);
  const followSessionLink = useLinkClickHandler<HTMLAnchorElement>(sessionRoute);
  // The row key is built from the report, which resolved to this very session.
  const rowKey = interactive && state.sessionId !== null ? entry.rowKey : null;
  return (
    <div className="w-[440px] max-w-full min-w-0">
      <SubagentTranscriptCard
        title={state.title}
        status={state.status}
        statusLabel={state.label}
        invocationLabel={
          entry.action === "spawn-agent" && requestStatus === null
            ? entry.presentation.label
            : undefined
        }
        currentSessionStatus={state.sessionId !== null && requestStatus === null}
        error={
          entry.status === "failed" &&
          (entry.action !== "spawn-agent" ||
            entry.presentation.resultPreview !== entry.presentation.label)
            ? entry.presentation.resultPreview
            : null
        }
        lineage={LINEAGE[entry.action]}
        showBehaviorIcon={showBehaviorIcon}
        onOpen={rowKey ? () => openSubagent(rowKey) : undefined}
        sessionHref={rowKey ? sessionHref : null}
        onSessionLinkClick={followSessionLink}
      />
      {entry.action === "spawn-agent" ? (
        <details className="mt-1 pl-3.5 text-basic-tertiary">
          <summary
            className="cursor-pointer type-meta"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            Invocation details
          </summary>
          {detailsOpen ? (
            <div className="pt-2">
              <ToolCallDetail tool={entry.presentation} />
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
});
