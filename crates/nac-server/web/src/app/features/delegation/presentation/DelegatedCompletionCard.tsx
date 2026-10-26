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
 * it is a plain summary.
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
    </div>
  );
}
