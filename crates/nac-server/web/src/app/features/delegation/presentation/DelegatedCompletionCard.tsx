import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useContext } from "react";

import {
  InsightsNavigationContext,
  useInsightsNavigation,
} from "@/app/features/insights/useInsightsNavigation";
import { useTranscriptSessionId } from "@/app/features/insights/transcript/transcriptTurns";
import { queryKeys, useTraditionalChildren } from "@/app/services/queries";
import type { DelegatedCompletionTurn } from "@/app/lib/transcript";
import type { DelegatedRowKey } from "@/app/features/insights/model/types";

/** A receipt is a historical generation, not the child's current status. */
export function DelegatedCompletionCard({
  turn,
  interactive = true,
}: {
  turn: DelegatedCompletionTurn;
  interactive?: boolean;
}) {
  const { completion } = turn;
  const type = "Subagent";
  const parent = useTranscriptSessionId();
  const navigation = useContext(InsightsNavigationContext);
  const { openSubagent } = useInsightsNavigation();
  const cache = useQueryClient();
  const parentId = parent ?? "";
  const eligible =
    interactive &&
    !!parent &&
    parent === navigation.sessionId &&
    navigation.panels.includes("delegated");
  const known = cache.getQueryState(queryKeys.traditionalChildren(parentId));
  const fetch = eligible && known?.data === undefined && known?.status !== "error";
  const query = useTraditionalChildren(parentId, fetch);
  const exists = query.data?.some((record) => record.child_session_id === completion.sessionId);
  const rowKey: DelegatedRowKey = `child:${completion.sessionId}`;
  const title = completion.description.trim() || type;
  const availability =
    eligible && !exists
      ? query.isError
        ? "Session unavailable"
        : query.data === undefined
          ? "Checking session…"
          : "Session not found"
      : null;

  return (
    <div role="status" aria-label={`${type} ${completion.status}`} className="min-w-0 py-1 md:pl-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 type-meta text-basic-secondary">
        {eligible && exists ? (
          <button
            type="button"
            aria-label={`Open ${title} in Subagents`}
            onClick={() => openSubagent(rowKey)}
            className="btn btn-small btn-icon-right btn-secondary max-w-full min-w-0 cursor-pointer max-md:min-h-11"
          >
            <span className="min-w-0 truncate">{title}</span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
          </button>
        ) : (
          <span className="min-w-0 break-words font-medium text-basic-primary">{title}</span>
        )}
        <span>
          {type} · Generation {completion.generation} · {completion.status}
        </span>
        {availability ? <span>{availability}</span> : null}
      </div>
      <details className="group/result mt-1 min-w-0 type-meta text-basic-secondary">
        <summary className="w-fit cursor-pointer rounded-md text-basic-tertiary hover:text-basic-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]">
          Generation {completion.generation} result
        </summary>
        <div className="mt-2 flex flex-col gap-2 whitespace-pre-wrap break-words type-body-chrome">
          {completion.outcome ? <p>{completion.outcome}</p> : null}
          {completion.changes ? <p>Changes: {completion.changes}</p> : null}
          {completion.verification ? <p>Verification: {completion.verification}</p> : null}
          {!completion.outcome && !completion.changes && !completion.verification ? (
            <p>No result details were retained.</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
