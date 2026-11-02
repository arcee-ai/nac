import { useState } from "react";
import { Button, ButtonSize, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { ProductDestinationInfo } from "@/app/types/api";
import { useProductContext } from "./queries";

export function ProductContextModal({
  open,
  sessionId,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  onClose(): void;
}) {
  const runtime = useNativeRuntime();
  const { data, isPending, error, refetch } = useProductContext(sessionId, open);
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
    <Modal open={open} onClose={onClose} title="NAC capabilities" size={ModalSize.Medium}>
      <div className="flex flex-col gap-4 text-sm leading-6">
        <p>
          Current product facts. Availability describes this runtime; operations keep their own
          authorization checks.
        </p>
        {isPending ? <p role="status">Reading capabilities…</p> : null}
        {error ? (
          <p role="alert">
            Product context is unavailable.
            {error.message.includes("presentation changed")
              ? " Reload this app to reconnect to its current serving instance."
              : ""}
          </p>
        ) : null}
        {data ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 break-words">
              <dt>Version</dt>
              <dd>
                {data.build.product_version} · {data.build.track}
              </dd>
              <dt>Deployment</dt>
              <dd>{data.managed ? "Managed" : "Standalone"}</dd>
              <dt>Source</dt>
              <dd>{data.source}</dd>
              <dt>Build</dt>
              <dd className="break-all font-mono text-xs">{data.build.build_id}</dd>
              <dt>Revision</dt>
              <dd className="break-all font-mono text-xs">{data.build.source_revision}</dd>
              {data.session ? (
                <>
                  <dt>Session behavior</dt>
                  <dd>{data.session.behavior}</dd>
                  <dt>Execution backend</dt>
                  <dd>{data.session.execution_backend}</dd>
                  <dt>Skills</dt>
                  <dd>
                    {data.session.skills.availability}
                    {data.session.skills.count == null ? "" : ` (${data.session.skills.count})`}
                  </dd>
                  <dt>Tools</dt>
                  <dd>
                    {data.session.tools.availability}
                    {data.session.tools.count == null ? "" : ` (${data.session.tools.count})`}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Session</dt>
                  <dd>No current session</dd>
                </>
              )}
              <dt>MCP dashboard</dt>
              <dd>
                {data.mcp.availability}
                {data.mcp.count == null ? "" : ` (${data.mcp.count} connected)`}
              </dd>
            </dl>
            <ul aria-label="Product features" className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {data.features.map((feature) => (
                <li key={feature.feature}>
                  {feature.label}: {feature.availability}
                </li>
              ))}
            </ul>
            <p className="text-basic-muted">
              Unknown means no current observation is available. Opening a destination does not
              submit a form or start work.
            </p>
            <nav
              aria-label="Product destinations"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {data.destinations.map((target) => (
                <div key={target.destination} className="flex flex-col gap-1">
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
                    <p className="text-xs text-basic-muted">
                      {target.availability}. {target.steps}
                    </p>
                  ) : null}
                </div>
              ))}
            </nav>
          </>
        ) : null}
        <p role="status" aria-live="polite">
          {message}
        </p>
      </div>
    </Modal>
  );
}
