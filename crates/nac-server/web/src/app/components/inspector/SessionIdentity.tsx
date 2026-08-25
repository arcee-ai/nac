import { useNavigate } from "react-router-dom";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorLabel } from "@/app/lib/sessionBehavior";
import type { SessionBehavior, SessionLineage } from "@/app/types/api";

export function SessionIdentity({
  behavior,
  lineage,
}: {
  behavior: SessionBehavior | null;
  lineage: SessionLineage | null;
}) {
  const navigate = useNavigate();
  if (!behavior) return null;

  const relationship =
    lineage?.kind === "traditional-child"
      ? "Traditional coding agent"
      : lineage?.kind === "managed-orchestrator"
        ? "Managed NAC orchestrator"
        : null;

  return (
    <div className="flex min-h-9 w-full shrink-0 flex-wrap items-center gap-2 border-b border-border-primary bg-elevation-level-1 px-3 py-1.5">
      <span className="tag-label uppercase text-basic-tertiary">Immutable behavior</span>
      <span className="rounded-full bg-elevation-level-3 px-2 py-1 text-xs font-medium text-basic-primary">
        {sessionBehaviorLabel(behavior)}
      </span>
      {lineage ? (
        <>
          <span className="text-xs text-basic-secondary">
            {relationship} · {lineage.description}
          </span>
          <Button
            className="ml-auto"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={() => navigate(routes.session(lineage.parent_session_id))}
          >
            Back to Parent
          </Button>
        </>
      ) : null}
    </div>
  );
}
