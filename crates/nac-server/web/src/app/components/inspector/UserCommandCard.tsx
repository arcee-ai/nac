import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionMessage,
  ChatSessionMessageVariant,
} from "@/app/atoms";
import { isActiveUserCommand } from "@/app/features/direct-session/userCommand";
import { formatDurationShort } from "@/app/lib/format";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { ApiError } from "@/app/services/nacClient";
import { useCancelUserCommand, useUserCommand, useUserCommandOutput } from "@/app/services/queries";
import { draftPrompt } from "@/app/store/composerStore";
import type { UserCommandSnapshot, UserCommandState } from "@/app/types/api";

const STATE_LABELS: Record<UserCommandState, string> = {
  admitted: "Starting",
  executing: "Running",
  completed: "Completed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
  spawn_failed: "Failed to start",
  rejected: "Rejected",
  interrupted: "Interrupted",
  outcome_unknown: "Outcome unknown",
};

function variantFor(command: UserCommandSnapshot): ChatSessionMessageVariant {
  if (isActiveUserCommand(command.state)) return ChatSessionMessageVariant.Info;
  if (command.state === "completed" && command.exit_code === 0) {
    return ChatSessionMessageVariant.Success;
  }
  if (command.state === "completed" || command.state === "cancelled") {
    return ChatSessionMessageVariant.Danger;
  }
  return ChatSessionMessageVariant.Error;
}

function followUpText(command: UserCommandSnapshot): string {
  return `About the output of \`${command.command}\` above: `;
}

function Preview({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="tag-label uppercase text-basic-secondary">{label}</span>
      <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-elevation-level-2 px-3 py-2 code-small text-basic-primary">
        {text}
      </pre>
    </div>
  );
}

function RetainedOutput({ sessionId, requestId }: { sessionId: string; requestId: string }) {
  const [open, setOpen] = useState(false);
  const output = useUserCommandOutput(sessionId, requestId, open);
  if (!open) {
    return (
      <Button
        type="button"
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Text}
        onClick={() => setOpen(true)}
      >
        Show full output
      </Button>
    );
  }
  if (output.error instanceof ApiError && output.error.status === 410) {
    return <span className="text-basic-secondary">Output no longer retained</span>;
  }
  if (output.isError) {
    return (
      <span role="alert">Unable to load output: {errorMessage(toRunError(output.error))}</span>
    );
  }
  const content = output.data?.pages.map((page) => page.content).join("") ?? "";
  return (
    <div className="flex flex-col items-start gap-1">
      <Preview label="Output" text={content || (output.isPending ? "Loading…" : "(no output)")} />
      {output.hasNextPage ? (
        <Button
          type="button"
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          content={ButtonContent.Text}
          disabled={output.isFetchingNextPage}
          onClick={() => void output.fetchNextPage()}
        >
          Load more output
        </Button>
      ) : null}
    </div>
  );
}

/** A command the user ran with `!`, attributed to them rather than to the model. */
export function UserCommandCard({
  sessionId,
  command: initial,
}: {
  sessionId: string;
  command: UserCommandSnapshot;
}) {
  const command = useUserCommand(sessionId, initial);
  const cancel = useCancelUserCommand();
  const toast = useToast();
  const active = isActiveUserCommand(command.state);
  const label = STATE_LABELS[command.state];
  const exit = command.exit_code != null ? ` · exit ${command.exit_code}` : "";
  return (
    <ChatSessionMessage
      role="status"
      aria-label={`Command ${label.toLowerCase()}`}
      className="my-5"
      variant={variantFor(command)}
      title={`You ran a command · ${label}${exit}`}
    >
      <span className="flex flex-col gap-2">
        <pre className="whitespace-pre-wrap break-words code-small text-basic-primary">
          {command.command}
        </pre>
        <span className="text-basic-secondary">
          {command.wall_time_ms != null
            ? `Took ${formatDurationShort(command.wall_time_ms)} · `
            : ""}
          Timeout {formatDurationShort(command.timeout_ms)}
          {command.cwd ? ` · ${command.cwd}` : ""}
        </span>
        {command.reason ? <span className="whitespace-pre-wrap">{command.reason}</span> : null}
        <Preview label="stdout" text={command.stdout_preview} />
        <Preview label="stderr" text={command.stderr_preview} />
        {command.truncated || command.overflowed ? (
          <span className="text-basic-secondary">Preview truncated</span>
        ) : null}
        {command.output_id ? (
          <RetainedOutput sessionId={sessionId} requestId={command.request_id} />
        ) : null}
        <span className="flex flex-wrap gap-2">
          {active ? (
            <Button
              type="button"
              size={ButtonSize.Small}
              variant={ButtonVariant.GhostDestructive}
              content={ButtonContent.Text}
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(
                  { id: sessionId, requestId: command.request_id },
                  {
                    onError: (error) =>
                      toast.error(`Unable to cancel command: ${errorMessage(toRunError(error))}`),
                  },
                )
              }
            >
              Cancel command
            </Button>
          ) : (
            <Button
              type="button"
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Text}
              onClick={() => draftPrompt(followUpText(command))}
            >
              Ask about this
            </Button>
          )}
        </span>
      </span>
    </ChatSessionMessage>
  );
}
