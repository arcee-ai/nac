import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import type { SessionBehavior, SessionLineage } from "@/app/types/api";

export function SessionIdentity({
  behavior,
  lineage,
}: {
  behavior: SessionBehavior | null;
  lineage: SessionLineage | null;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  if (!behavior) return null;
  const presentation = sessionBehaviorPresentation(behavior);

  const relationship =
    lineage?.kind === "traditional-child"
      ? "Traditional coding agent"
      : lineage?.kind === "managed-orchestrator"
        ? "Managed NAC orchestrator"
        : null;

  if (lineage && relationship) {
    return (
      <nav
        aria-label="Delegated session breadcrumb"
        className="mt-16 flex min-h-9 w-full shrink-0 flex-wrap items-center gap-2 border-b border-border-primary bg-elevation-level-1 px-3 py-1.5 md:mt-0"
      >
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          onClick={() => navigate(routes.session(lineage.parent_session_id, "delegated"))}
        >
          Parent chat
        </Button>
        <span aria-hidden="true" className="text-basic-muted">
          →
        </span>
        <span className="text-xs font-medium text-basic-primary">{relationship}</span>
        <span className="min-w-0 truncate text-xs text-basic-secondary">{lineage.description}</span>
      </nav>
    );
  }

  return (
    <div className="flex min-h-9 w-full shrink-0 flex-wrap items-center gap-2 border-b border-border-primary bg-elevation-level-1 px-3 py-1.5">
      <span className="tag-label uppercase text-basic-tertiary">Immutable behavior</span>
      <span className="rounded-full bg-elevation-level-3 px-2 py-1 text-xs font-medium text-basic-primary">
        {presentation.label}
      </span>
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        aria-label={`About ${presentation.label}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        How it works
      </Button>
      {expanded ? (
        <div className="flex basis-full flex-col gap-1 pb-1 text-xs text-basic-secondary">
          <span>{presentation.topLevel}</span>
          <span>{presentation.editing}</span>
          <span>{presentation.delegation}</span>
          <span className="text-basic-muted">{presentation.inspection}</span>
          <span className="text-basic-muted">
            This behavior cannot change. Start a new chat to choose another one.
          </span>
        </div>
      ) : null}
    </div>
  );
}
