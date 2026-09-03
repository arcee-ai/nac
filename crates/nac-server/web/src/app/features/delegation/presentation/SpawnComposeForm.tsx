import { useEffect, useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Input,
  InputSize,
  SessionTypeAvatar,
  Switch,
  TextArea,
  TextAreaSize,
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
    hint: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Related Sessions.",
    promptLabel: "Complete task prompt",
    promptPlaceholder: "Describe the task, relevant context, and expected verification",
    submit: "Start coding agent",
    missing: "A short description and complete child prompt are required.",
    fail: "Unable to start child",
  },
  orchestrator: {
    title: "Launch orchestrator",
    hint: "Start a separate Orchestrator planning session. Browse, steer, continue, and cancel it from Related Sessions.",
    promptLabel: "Complete objective",
    promptPlaceholder: "Describe scope, constraints, and expected verification",
    submit: "Start orchestrator",
    missing: "A short description and complete orchestration objective are required.",
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
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);

  useEffect(() => {
    setDescription("");
    setPrompt("");
    setBackground(true);
  }, [behavior, parentSessionId]);

  const busy = start.isPending;
  const submit = async () => {
    const promptText = prompt.trim();
    const label = description.trim() || assignmentLabelFromPrompt(promptText);
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-muted px-3">
        <SessionTypeAvatar
          className="size-7 shrink-0"
          sessionType={sessionTypeFromBehavior(behavior)}
        />
        <span className="min-w-0 flex-1 truncate label-small text-basic-primary">
          {copy.title}
        </span>
      </div>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 [&>*]:shrink-0"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="label-micro text-basic-muted">{copy.hint}</p>
        <Input
          label="Short description"
          inputSize={InputSize.Medium}
          placeholder={
            behavior === "direct"
              ? "Review persistence"
              : "Implement the persistence slice"
          }
          value={description}
          maxLength={120}
          onChange={(event) => setDescription(event.target.value)}
        />
        <TextArea
          label={copy.promptLabel}
          textAreaSize={TextAreaSize.Medium}
          placeholder={copy.promptPlaceholder}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          textAreaClassName="h-[112px] resize-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 label-small text-basic-secondary">
            <Switch checked={background} disabled={busy} onChange={setBackground} />
            Run in background
          </label>
          <Button
            type="submit"
            size={ButtonSize.Medium}
            variant={ButtonVariant.Primary}
            loading={busy}
            disabled={busy}
          >
            {copy.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
