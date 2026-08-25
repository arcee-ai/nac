import { useNavigate } from "react-router-dom";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { routes } from "@/app/lib/routes";
import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";
import type {
  ManagedOrchestratorRecord,
  SessionBehavior,
  TraditionalChildRecord,
} from "@/app/types/api";

function status(status: string): string {
  return status.replaceAll("_", " ");
}

function DelegatedRow({
  id,
  description,
  type,
  statusText,
}: {
  id: string;
  description: string;
  type: string;
  statusText: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border-primary p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-small font-medium text-basic-primary">{description}</div>
        <div className="mt-0.5 text-xs text-basic-tertiary">
          {type} · {statusText}
        </div>
      </div>
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        onClick={() => navigate(routes.session(id))}
      >
        Open transcript
      </Button>
    </div>
  );
}

function CodingAgents({ children }: { children: TraditionalChildRecord[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="tag-label uppercase text-basic-secondary">Traditional coding agents</div>
      {children.length ? (
        children.map((child) => (
          <DelegatedRow
            key={child.child_session_id}
            id={child.child_session_id}
            description={child.description}
            type="General coding agent"
            statusText={`${status(child.status)} · generation ${child.generation}`}
          />
        ))
      ) : (
        <div className="rounded-[6px] border border-border-primary p-3 text-small text-basic-tertiary">
          No coding agents yet. Launch one from the people control below the composer.
        </div>
      )}
    </section>
  );
}

function NacOrchestrators({ orchestrators }: { orchestrators: ManagedOrchestratorRecord[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="tag-label uppercase text-basic-secondary">Managed NAC orchestrators</div>
      {orchestrators.length ? (
        orchestrators.map((orchestrator) => (
          <DelegatedRow
            key={orchestrator.orchestrator_session_id}
            id={orchestrator.orchestrator_session_id}
            description={orchestrator.description}
            type="Separate NAC orchestrator"
            statusText={`${status(orchestrator.status)} · generation ${orchestrator.generation}`}
          />
        ))
      ) : (
        <div className="rounded-[6px] border border-border-primary p-3 text-small text-basic-tertiary">
          No managed orchestrators yet. Launch one from the flow control below the composer.
        </div>
      )}
    </section>
  );
}

export function DelegatedWorkView({
  sessionId,
  behavior,
}: {
  sessionId: string;
  behavior: SessionBehavior;
}) {
  const children = useTraditionalChildren(sessionId, true);
  const supportsOrchestrators = behavior === "direct-with-orchestrator";
  const orchestrators = useManagedOrchestrators(sessionId, supportsOrchestrators);

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto p-3">
      <div>
        <h2 className="header-small text-basic-primary">Delegated work</h2>
        <p className="mt-1 text-small text-basic-secondary">
          Durable work launched by this direct agent. Open a row for its read-only transcript.
        </p>
      </div>
      {children.isPending ? (
        <div className="text-small text-basic-secondary">Loading coding agents…</div>
      ) : children.isError ? (
        <div className="text-small text-error-primary">Coding agents could not be loaded.</div>
      ) : (
        <CodingAgents children={children.data ?? []} />
      )}
      {supportsOrchestrators ? (
        orchestrators.isPending ? (
          <div className="text-small text-basic-secondary">Loading NAC orchestrators…</div>
        ) : orchestrators.isError ? (
          <div className="text-small text-error-primary">
            NAC orchestrators could not be loaded.
          </div>
        ) : (
          <NacOrchestrators orchestrators={orchestrators.data ?? []} />
        )
      ) : null}
    </div>
  );
}
