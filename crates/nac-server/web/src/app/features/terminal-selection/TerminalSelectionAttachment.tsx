import { useId } from "react";
import type { TerminalSelectionEvidence } from "@/app/types/api";

interface Props {
  evidence: TerminalSelectionEvidence;
  canonicalText: string;
  sessionId?: string;
}

/** Passive presentation of server-verified literal evidence; no source reads or actions. */
export function TerminalSelectionAttachment({ evidence, canonicalText, sessionId }: Props) {
  const id = useId();
  const source = evidence.attribution;
  const inherited = sessionId != null && source.source_session_id !== sessionId;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="w-full min-w-0 max-w-full rounded-lg border border-border-primary p-3 text-small text-basic-primary"
    >
      <h3 id={`${id}-title`} className="font-medium">
        Terminal selection
      </h3>
      <p className="text-basic-secondary mt-1">
        Reviewed rendered text · frozen capture. Live source availability is not checked.
        {inherited ? " Original source from another chat; no live access is granted." : ""}
      </p>
      <pre
        aria-label="Attached terminal output"
        tabIndex={0}
        className="mt-3 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3 font-mono"
      >
        {evidence.text}
      </pre>
      {evidence.user_text != null ? (
        <div className="mt-3">
          <span className="text-basic-secondary">Accompanying message</span>
          <pre
            aria-label="Attached accompanying message"
            tabIndex={0}
            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans"
          >
            {evidence.user_text}
          </pre>
        </div>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer">Source and capture details</summary>
        <dl className="mt-2 break-all">
          <dt>Source chat</dt>
          <dd>{source.source_session_id}</dd>
          <dt>Terminal</dt>
          <dd>{source.terminal_id}</dd>
          <dt>Process owner</dt>
          <dd>{source.owner_instance_id}</dd>
          <dt>Capture</dt>
          <dd>{source.capture_id}</dd>
          {source.client_capture_time_ms != null ? (
            <>
              <dt>Client capture time (client supplied, epoch ms)</dt>
              <dd>{source.client_capture_time_ms}</dd>
            </>
          ) : null}
          <dt>Submission</dt>
          <dd>{source.admission_id}</dd>
        </dl>
        <p className="mt-2 text-basic-secondary">
          This evidence remains readable after the source exits or expires. It grants no terminal
          control.
        </p>
      </details>
      <details className="mt-3">
        <summary className="cursor-pointer">Canonical message</summary>
        <pre
          aria-label="Canonical terminal evidence message"
          tabIndex={0}
          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono"
        >
          {canonicalText}
        </pre>
      </details>
    </section>
  );
}
