import { useHref, useLinkClickHandler } from "react-router-dom";

import { SubagentTranscriptCard } from "@/app/atoms";
import { cardStatus } from "@/app/features/delegation/presentation/cardStatus";
import type { DelegatedRowKey } from "@/app/features/insights/model/types";
import { useInsightsNavigation } from "@/app/features/insights/useInsightsNavigation";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useSessionBehaviorIconVisible } from "@/app/features/ui-policy/useSessionBehaviorIconVisible";
import { routes } from "@/app/lib/routes";
import type { DelegatedCompletionTurn } from "@/app/lib/transcript";

const KIND = {
  "coding-agent": { type: "Coding agent", lineage: "traditional-child", row: "child" },
  "nac-orchestrator": {
    type: "NAC orchestrator",
    lineage: "managed-orchestrator",
    row: "orchestrator",
  },
} as const;

/**
 * Where a delegated session's result reached its parent: the session's card,
 * opening it in Subagents and linking to its own page. Without `interactive`
 * it is a plain summary. Keep the retained generation's receipt available in
 * either case: navigation can be disabled, and the session preview can show a
 * newer generation than this completion.
 */
export function DelegatedCompletionCard({
  turn,
  interactive = true,
}: {
  turn: DelegatedCompletionTurn;
  interactive?: boolean;
}) {
  const { completion } = turn;
  const kind = KIND[completion.kind];
  const policy = useUiPolicy();
  const showBehaviorIcon = useSessionBehaviorIconVisible();
  const { openSubagent } = useInsightsNavigation();
  const sessionRoute = routes.session(completion.sessionId);
  const sessionHref = useHref(sessionRoute);
  const followSessionLink = useLinkClickHandler<HTMLAnchorElement>(sessionRoute);
  // Without NAC orchestration an orchestrator is no session the user can open.
  const openable =
    interactive && (policy.orchestrationEnabled || completion.kind === "coding-agent");
  const rowKey: DelegatedRowKey = `${kind.row}:${completion.sessionId}`;
  const { status, label } = cardStatus(completion.status);
  return (
    <div role="status" aria-label={`${kind.type} ${completion.status}`} className="py-6 md:pl-2">
      <SubagentTranscriptCard
        title={completion.description.trim() || kind.type}
        status={status}
        statusLabel={label}
        lineage={kind.lineage}
        showBehaviorIcon={showBehaviorIcon}
        onOpen={openable ? () => openSubagent(rowKey) : undefined}
        sessionHref={openable ? sessionHref : null}
        onSessionLinkClick={followSessionLink}
      />
      <details className="mt-2 w-[320px] max-w-full min-w-0 rounded-[4px] bg-elevation-level-1 p-3 text-xs text-basic-secondary">
        <summary className="cursor-pointer rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]">
          Generation {completion.generation} result
        </summary>
        <div className="mt-2 flex flex-col gap-2 whitespace-pre-wrap break-words">
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
