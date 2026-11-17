import {
  BoxSurface,
  CircularLoader,
  Loader,
  LoaderSize,
  ProgressLoader,
  ShimmerLoader,
  StatusDot,
} from "@/app/atoms";
import { SESSION_STATUS_ORDER, mostUrgent, needsYou, sessionStatus } from "@/app/lib/sessionStatus";
import { Specimen } from "@/app/components/pages/design-preview/Showcase";

const ROLLUP = mostUrgent(["done", "working", "needs-answer", "idle"]);

/** The one status ladder, the one "working" animation and the plain loaders. */
export function StatusSection() {
  return (
    <BoxSurface title="Status">
      <Specimen label="Ladder" hint="Most urgent first; a row shows only its top rung.">
        <ol className="flex w-full flex-col gap-2">
          {SESSION_STATUS_ORDER.map((status, index) => (
            <li key={status} className="flex items-center gap-3">
              <span className="type-meta tabular w-4 text-right text-basic-muted">{index + 1}</span>
              <StatusDot status={status} size="md" labelled />
              {needsYou(status) ? (
                <span className="type-tag rounded-pill bg-danger-primary px-2 py-0.5 text-danger-primary">
                  Needs you
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </Specimen>
      <Specimen label="Roll-up" hint="A parent shows its most urgent child.">
        <span className="type-body-chrome text-basic-secondary">
          done, working, needs an answer, idle
        </span>
        <span aria-hidden className="text-basic-muted">
          →
        </span>
        <StatusDot status={ROLLUP} size="md" labelled />
        <code className="code-small text-basic-muted">
          sessionStatus(…) = {sessionStatus({ running: true, pendingQuestions: 1 })}
        </code>
      </Specimen>
      <Specimen label="Working" hint="The only agent-working animation.">
        <div className="flex items-center gap-2">
          <StatusDot status="working" />
          <span className="type-body-chrome focus-shimmer">Running tests…</span>
          <span className="type-meta tabular text-basic-muted">1m 12s</span>
        </div>
      </Specimen>
      <Specimen label="Loaders" hint="Plain and quiet, for everything that is not the agent.">
        <Loader size={LoaderSize.Small} aria-label="Loading" />
        <CircularLoader size={LoaderSize.Medium} />
        <ShimmerLoader rows={3} className="w-[200px]" />
        <div className="w-[200px] overflow-hidden rounded-pill bg-elevation-sublevel-variant-A">
          <ProgressLoader active />
        </div>
      </Specimen>
    </BoxSurface>
  );
}
