import { useState, type ReactNode } from "react";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ProductDestinationInfo } from "@/app/types/api";
import { useProductContext } from "./queries";

function Fact({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="type-label shrink-0 text-basic-secondary">{label}</dt>
      <dd
        className={
          mono
            ? "code-small min-w-0 break-all text-right text-basic-primary"
            : "type-body-chrome min-w-0 break-words text-right text-basic-primary"
        }
      >
        {children}
      </dd>
    </div>
  );
}

const CARD =
  "flex min-w-0 flex-col divide-y divide-[var(--f-line-soft)] overflow-hidden rounded-card border border-tertiary bg-elevation-level-1";

/**
 * Settings › Capabilities: what this runtime is and offers, read fresh. Opening
 * a destination goes through the runtime's bounded navigation bridge; it never
 * submits a form or starts work. `sessionId` scopes the facts to the session
 * the user came from, when they came from one.
 */
export function ProductContextPanel({ sessionId }: { sessionId: string | null }) {
  const runtime = useNativeRuntime();
  const { data, isPending, error, refetch } = useProductContext(sessionId, true);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = async (target: ProductDestinationInfo) => {
    if (!data || pending) return;
    if (!runtime.productNavigation) {
      setMessage(target.steps);
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const result = await runtime.productNavigation.open({
        destination: target.destination,
        session_id: sessionId,
        expected_build_id: data.build.build_id,
      });
      if (!result.opened) setMessage(result.target.steps);
    } catch {
      await refetch();
      setMessage(
        "This destination is unavailable or the view changed. Close and inspect capabilities again.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {isPending ? (
        <p role="status" className="type-body-chrome text-basic-tertiary">
          Reading capabilities…
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="type-body-chrome rounded-card border border-[var(--f-red-line)] bg-[var(--f-red-wash)] px-4 py-3 text-[var(--f-red-text)]"
        >
          Product context is unavailable.
          {error.message.includes("presentation changed")
            ? " Reload this app to reconnect to its current serving instance."
            : ""}
        </p>
      ) : null}
      {data ? (
        <>
          <section className="flex flex-col gap-2" aria-label="Runtime facts">
            <h3 className="type-strong px-1 text-basic-primary">This runtime</h3>
            <dl className={CARD}>
              <Fact label="Version">
                {data.build.product_version} · {data.build.track}
              </Fact>
              <Fact label="Deployment">{data.managed ? "Managed" : "Standalone"}</Fact>
              <Fact label="Source">{data.source}</Fact>
              <Fact label="Build" mono>
                {data.build.build_id}
              </Fact>
              <Fact label="Revision" mono>
                {data.build.source_revision}
              </Fact>
              <Fact label="MCP dashboard">
                {data.mcp.availability}
                {data.mcp.count == null ? "" : ` (${data.mcp.count} connected)`}
              </Fact>
            </dl>
          </section>
          <section className="flex flex-col gap-2" aria-label="Session facts">
            <h3 className="type-strong px-1 text-basic-primary">Session</h3>
            <dl className={CARD}>
              {data.session ? (
                <>
                  <Fact label="Session behavior">{data.session.behavior}</Fact>
                  <Fact label="Execution backend">{data.session.execution_backend}</Fact>
                  <Fact label="Skills">
                    {data.session.skills.availability}
                    {data.session.skills.count == null ? "" : ` (${data.session.skills.count})`}
                  </Fact>
                  <Fact label="Tools">
                    {data.session.tools.availability}
                    {data.session.tools.count == null ? "" : ` (${data.session.tools.count})`}
                  </Fact>
                </>
              ) : (
                <Fact label="Session">No current session</Fact>
              )}
            </dl>
          </section>
          <section className="flex flex-col gap-2" aria-label="Features">
            <h3 className="type-strong px-1 text-basic-primary">Features</h3>
            <ul aria-label="Product features" className={CARD}>
              {data.features.map((feature) => (
                <li
                  key={feature.feature}
                  className="type-body-chrome flex min-h-11 items-center justify-between gap-4 px-4 py-2.5"
                >
                  <span className="text-basic-primary">{feature.label}</span>
                  <span className="text-basic-tertiary">{feature.availability}</span>
                </li>
              ))}
            </ul>
            <p className="type-meta px-1 text-basic-tertiary">
              Availability describes this runtime; operations keep their own authorization checks.
              Unknown means no current observation is available.
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="type-strong px-1 text-basic-primary">Destinations</h3>
            <nav
              aria-label="Product destinations"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {data.destinations.map((target) => (
                <div key={target.destination} className="flex min-w-0 flex-col gap-1">
                  <Button
                    variant={ButtonVariant.Secondary}
                    size={ButtonSize.Large}
                    disabled={pending || target.availability !== "available"}
                    onClick={() => void navigate(target)}
                    aria-label={`Open ${target.label}`}
                  >
                    {target.label}
                  </Button>
                  {target.availability !== "available" ? (
                    <p className="type-meta px-1 text-basic-tertiary">
                      {target.availability}. {target.steps}
                    </p>
                  ) : null}
                </div>
              ))}
            </nav>
            <p className="type-meta px-1 text-basic-tertiary">
              Opening a destination does not submit a form or start work.
            </p>
          </section>
        </>
      ) : null}
      <p role="status" aria-live="polite" className="type-body-chrome text-basic-secondary">
        {message}
      </p>
    </div>
  );
}
