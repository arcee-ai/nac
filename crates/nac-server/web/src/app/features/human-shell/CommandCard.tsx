import { useState } from "react";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useCancelShellCommand, useShellOutput } from "./queries";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
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
  const { draftPrompt } = useNativeRuntime().stores.composerStore;
  const [showOutput, setShowOutput] = useState(false);
  const [offset, setOffset] = useState(0);
  const output = useShellOutput(sessionId, command.request_id, offset, showOutput);
  const cancel = useCancelShellCommand(sessionId);
  const active = command.state === "accepted" || command.state === "started";
  return (
    <article
      aria-label="User command"
      className="my-3 rounded-xl border border-border-primary bg-bg-elevation-level-1 p-4"
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
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(command.request_id)}
          >
            Cancel command
          </Button>
        ) : null}
        {!active && command.output_id ? (
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={() => setShowOutput((shown) => !shown)}
          >
            {showOutput ? "Hide output" : "Full output"}
          </Button>
        ) : null}
        {!active && !readOnly ? (
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            onClick={() =>
              draftPrompt(
                sessionId,
                `Explain the result of my command ${command.request_id}:\n!${command.command}`,
              )
            }
          >
            Ask about this
          </Button>
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
                  <Button
                    type="button"
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Ghost}
                    onClick={() => setOffset(0)}
                  >
                    Start
                  </Button>
                ) : null}
                {!output.data.eof ? (
                  <Button
                    type="button"
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Ghost}
                    onClick={() => setOffset(output.data.next_offset)}
                  >
                    Next page
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
