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
      className="mt-6 flex w-full min-w-0 flex-col gap-2 rounded-card border border-tertiary bg-elevation-level-1 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="type-label text-basic-primary">Run by you</strong>
        <span role="status" className="type-meta tabular text-basic-tertiary">
          {command.state.replaceAll("_", " ")}
          {command.exit_code != null ? ` · exit ${command.exit_code}` : ""}
        </span>
      </div>
      <pre className="!my-0 overflow-x-auto code code-medium whitespace-pre-wrap break-words text-basic-primary">{`!${command.command}`}</pre>
      {command.stdout ? (
        <pre className="!my-0 max-h-80 overflow-auto rounded-md border border-muted bg-[var(--color-code-bg)] px-3 py-2 code code-medium whitespace-pre-wrap break-words text-basic-primary">
          {command.stdout}
        </pre>
      ) : null}
      {command.stderr ? (
        <pre className="!my-0 max-h-80 overflow-auto rounded-md border border-muted bg-[var(--color-code-bg)] px-3 py-2 code code-medium whitespace-pre-wrap break-words text-error-primary">
          {command.stderr}
        </pre>
      ) : null}
      {command.diagnostic ? (
        <p className="!my-0 type-body-chrome text-basic-secondary">{command.diagnostic}</p>
      ) : null}
      <div className="-ml-2 flex flex-wrap gap-1">
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
      {cancel.error ? (
        <p role="alert" className="!my-0 type-body-chrome text-error-primary">
          Unable to cancel this command.
        </p>
      ) : null}
      {showOutput ? (
        <div className="flex flex-col gap-2 type-body-chrome text-basic-secondary">
          {output.isPending ? <p className="!my-0">Loading output…</p> : null}
          {output.error ? (
            <p role="status" className="!my-0">
              Full output is no longer retained.
            </p>
          ) : null}
          {output.data ? (
            <>
              {output.data.overflowed ? (
                <p className="!my-0">Only retained output is available.</p>
              ) : null}
              <pre className="!my-0 max-h-80 overflow-auto rounded-md border border-muted bg-[var(--color-code-bg)] px-3 py-2 code code-medium whitespace-pre-wrap break-words text-basic-primary">
                {output.data.content}
              </pre>
              <div className="-ml-2 flex gap-1">
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
