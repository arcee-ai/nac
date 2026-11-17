import { useEffect, useRef, useState } from "react";

import { useToolCallContent } from "@/app/services/queries/toolCalls";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

const RESULT_STATES: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

/** Parse only native delegation records; the text has already been redacted by the server. */
function invocationOutcome(
  output: string,
): { generation: number; status: string; fields: [string, string][] } | null {
  try {
    const value: unknown = JSON.parse(output);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      !(
        typeof record.child_session_id === "string" ||
        typeof record.orchestrator_session_id === "string"
      ) ||
      typeof record.generation !== "number" ||
      !Number.isSafeInteger(record.generation) ||
      record.generation < 1 ||
      typeof record.status !== "string" ||
      !Object.hasOwn(RESULT_STATES, record.status)
    )
      return null;
    const fields: [string, string][] = [];
    for (const [key, label] of [
      ["report", "Result"],
      ["failure", "Failure"],
      ["change_summary", "Changes"],
      ["verification_summary", "Verification"],
    ] as const) {
      const item = record[key];
      if (item != null && typeof item !== "string") return null;
      if (typeof item === "string" && item.trim()) fields.push([label, item]);
    }
    return { generation: record.generation, status: RESULT_STATES[record.status], fields };
  } catch {
    return null;
  }
}

function InvocationOutput({ output, truncated }: { output: string; truncated: boolean }) {
  const outcome = invocationOutcome(output);
  const structured = /^\s*[{[]/.test(output);
  return (
    <>
      {outcome ? (
        <div className="flex flex-col gap-2 whitespace-pre-wrap break-words type-body-chrome">
          <p>
            Generation {outcome.generation} · {outcome.status}
          </p>
          {outcome.fields.map(([label, value]) => (
            <p key={label}>
              <span className="font-medium">{label}: </span>
              {value}
            </p>
          ))}
          {outcome.fields.length === 0 ? (
            <p>
              {outcome.status === "Running"
                ? "Work is running in the background. Completion will be delivered automatically."
                : "No result details were retained."}
            </p>
          ) : null}
          <FullRetainedResult output={output} />
        </div>
      ) : structured ? (
        <div>
          <p>Result details could not be displayed in this format.</p>
          <FullRetainedResult output={output} />
        </div>
      ) : (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words type-body-chrome">
          {output}
        </pre>
      )}
      {truncated ? <p>Result truncated at 256 KiB.</p> : null}
    </>
  );
}

function FullRetainedResult({ output }: { output: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="w-fit cursor-pointer rounded-md underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]">
        Show retained result
      </summary>
      {open ? (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words type-body-chrome">
          {output}
        </pre>
      ) : null}
    </details>
  );
}

/** The server redacts and bounds this call's own retained output before display. */
export function DelegationInvocationResult({
  sessionId,
  blockKey,
  tool,
}: {
  sessionId: string;
  blockKey: string;
  tool: ToolPresentation;
}) {
  const [open, setOpen] = useState(false);
  // A finish event can arrive before the full parallel batch is persisted.
  const awaitingResult = tool.resultMayBePending === true;
  const { data, refetch, isError, isPending, isFetching } = useToolCallContent(
    sessionId,
    { id: tool.callId, blockKey, occurrence: tool.occurrence },
    open,
    awaitingResult,
  );
  const wasAwaiting = useRef(awaitingResult);
  const checkAfterSettlement = useRef(false);
  useEffect(() => {
    if (wasAwaiting.current && !awaitingResult && open) checkAfterSettlement.current = true;
    wasAwaiting.current = awaitingResult;
    if (!open) {
      checkAfterSettlement.current = false;
      return;
    }
    if (!checkAfterSettlement.current || isFetching || isPending) return;
    checkAfterSettlement.current = false;
    // Do not retry redaction or transport failures without the reader's request.
    if (!isError && data?.output === null) void refetch();
  }, [awaitingResult, open, isFetching, isPending, isError, data?.output, refetch]);
  return (
    <details
      className="min-w-0 type-meta text-basic-secondary"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="w-fit cursor-pointer rounded-md text-basic-tertiary hover:text-basic-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]">
        Invocation result
      </summary>
      {open ? (
        <div className="mt-2 min-w-0">
          {isError ? (
            <p role="alert">
              Could not load this invocation result.{" "}
              <button type="button" className="underline" onClick={() => void refetch()}>
                Try again
              </button>
            </p>
          ) : data?.output != null ? (
            <InvocationOutput output={data.output} truncated={data.output_truncated} />
          ) : isPending || isFetching || awaitingResult ? (
            <p>Waiting for invocation result…</p>
          ) : (
            <p>No invocation result was recorded.</p>
          )}
        </div>
      ) : null}
    </details>
  );
}
