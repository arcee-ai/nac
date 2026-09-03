import { useEffect, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Switch,
  TextArea,
  TextAreaSize,
  sessionTypeIconName,
} from "@/app/atoms";
import { assignmentLabelFromPrompt } from "@/app/features/delegation/model";
import { toRunError } from "@/app/lib/providerError";
import { sessionTypeFromBehavior } from "@/app/lib/sessionBehavior";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useStartSessionSpawn } from "@/app/services/queries";
import type { SessionAssignmentChildBehavior } from "@/app/types/api";

const COPY = {
  direct: {
    title: "Launch coding agent",
    hint: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Back Chat.",
    promptPlaceholder:
      "Describe the task, relevant context, and expected verification",
    submit: "Start coding agent",
    missing: "A complete child prompt is required.",
    fail: "Unable to start child",
  },
  orchestrator: {
    title: "Launch orchestrator",
    hint: "Start a separate Orchestrator planning session. Browse, steer, continue, and cancel it from Back Chat.",
    promptPlaceholder: "Describe scope, constraints, and expected verification",
    submit: "Start orchestrator",
    missing: "A complete orchestration objective is required.",
    fail: "Unable to start orchestrator",
  },
} as const;

export function SpawnComposeForm({
  parentSessionId,
  behavior,
  onStarted,
}: {
  parentSessionId: string;
  behavior: SessionAssignmentChildBehavior;
  onStarted: (childSessionId: string) => void;
}) {
  const start = useStartSessionSpawn();
  const toast = useToast();
  const copy = COPY[behavior];
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);

  useEffect(() => {
    setPrompt("");
    setBackground(true);
    promptRef.current?.focus();
  }, [behavior, parentSessionId]);

  const busy = start.isPending;
  const canSend = prompt.trim().length > 0 && !busy;

  const submit = async () => {
    const promptText = prompt.trim();
    const label = assignmentLabelFromPrompt(promptText);
    if (!label || !promptText) {
      toast.error(copy.missing);
      return;
    }
    try {
      const assignment = await start.mutateAsync({
        sessionId: parentSessionId,
        payload: {
          behavior,
          description: label,
          prompt: promptText,
          background,
        },
      });
      onStarted(assignment.child_session_id);
    } catch (error) {
      toast.error(`${copy.fail}: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto px-4 [&>*]:shrink-0">
      <div className="flex w-full flex-col items-center gap-4">
        <div className="flex max-w-[400px] flex-col items-center gap-2">
          <Icon
            iconName={sessionTypeIconName(sessionTypeFromBehavior(behavior))}
            size={32}
            className="shrink-0 text-basic-primary"
          />
          <p className="label-big text-center text-basic-primary">
            {copy.title}
          </p>
          <p className="label-small text-center text-basic-tertiary">
            {copy.hint}
          </p>
        </div>
        <form
          className="flex w-full flex-col gap-2 rounded-[8px] bg-elevation-level-1 p-3 shadow-2xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) void submit();
          }}
        >
          <TextArea
            ref={promptRef}
            aria-label={copy.title}
            textAreaSize={TextAreaSize.Medium}
            placeholder={copy.promptPlaceholder}
            value={prompt}
            isDisabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, as it does in the chat composer; Shift keeps the
              // newline and the modifier combo stays for the muscle memory it
              // was written for.
              if (event.nativeEvent.isComposing) return;
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (canSend) void submit();
            }}
            textAreaClassName="h-[126px] resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 label-micro text-basic-primary">
              <Switch
                checked={background}
                disabled={busy}
                onChange={setBackground}
              />
              Run in background
            </label>
            <Button
              type="submit"
              size={ButtonSize.Medium}
              variant={ButtonVariant.Primary}
              content={ButtonContent.Icon}
              loading={busy}
              disabled={!canSend}
              aria-label={copy.submit}
            >
              <Icon iconName={IconName.ArrowTop} />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
