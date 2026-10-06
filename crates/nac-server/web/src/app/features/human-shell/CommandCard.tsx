import { useState } from "react";
import { useCancelShellCommand, useShellOutput } from "./queries";
import { draftPrompt } from "@/app/store/composerStore";
import type { ShellCommandSnapshot } from "@/app/types/api";

export function CommandCard({
  sessionId,
  command,
  readOnly = false,
}: {
  sessionId: string;
  command: ShellCommandSnapshot;
  readOnly?: boolean;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const [offset, setOffset] = useState(0);
  const output = useShellOutput(sessionId, command.request_id, offset, showOutput);
  const cancel = useCancelShellCommand(sessionId);
  const active = command.state === "accepted" || command.state === "started";
  return (
    <article
      aria-label="User command"
      className="my-3 rounded-xl border border-white/10 bg-white/5 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <strong>Run by you</strong>
        <span role="status">
          {command.state.replaceAll("_", " ")}
          {command.exit_code != null ? ` · exit ${command.exit_code}` : ""}
        </span>
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm">{`!${command.command}`}</pre>
      {command.stdout ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm">
          {command.stdout}
        </pre>
      ) : null}
      {command.stderr ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm">
          {command.stderr}
        </pre>
      ) : null}
      {command.diagnostic ? <p className="mt-2 text-sm">{command.diagnostic}</p> : null}
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {active && !readOnly ? (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(command.request_id)}
          >
            Cancel command
          </button>
        ) : null}
        {!active && command.output_id ? (
          <button type="button" onClick={() => setShowOutput((shown) => !shown)}>
            {showOutput ? "Hide output" : "Full output"}
          </button>
        ) : null}
        {!active && !readOnly ? (
          <button
            type="button"
            onClick={() =>
              draftPrompt(
                sessionId,
                `Explain the result of my command ${command.request_id}:\n!${command.command}`,
              )
            }
          >
            Ask about this
          </button>
        ) : null}
      </div>
      {cancel.error ? <p role="alert">Unable to cancel this command.</p> : null}
      {showOutput ? (
        <div className="mt-3">
          {output.isPending ? <p>Loading output…</p> : null}
          {output.error ? <p role="status">Full output is no longer retained.</p> : null}
          {output.data ? (
            <>
              {output.data.overflowed ? <p>Only retained output is available.</p> : null}
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm">
                {output.data.content}
              </pre>
              <div className="mt-2 flex gap-4">
                {offset > 0 ? (
                  <button type="button" onClick={() => setOffset(0)}>
                    Start
                  </button>
                ) : null}
                {!output.data.eof ? (
                  <button type="button" onClick={() => setOffset(output.data.next_offset)}>
                    Next page
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
