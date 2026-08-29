import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Modal,
  ModalSize,
  Switch,
  TextArea,
  TextAreaSize,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useManagedOrchestrators, useStartManagedOrchestrator } from "@/app/services/queries";
import { isAgentBehavior } from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";

interface OrchestratorControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

/** Internal durable NAC orchestration controls for the delegating direct behavior. */
export function OrchestratorControls({ sessionId, behavior }: OrchestratorControlsProps) {
  const enabled = isAgentBehavior(behavior);
  const query = useManagedOrchestrators(sessionId, enabled);
  const start = useStartManagedOrchestrator();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);

  if (!enabled) return null;
  const orchestrators = query.data ?? [];
  const busy = start.isPending;
  const reset = () => {
    setDescription("");
    setPrompt("");
  };
  const submit = async () => {
    if (!description.trim() || !prompt.trim()) {
      toast.error("A short description and complete orchestration objective are required.");
      return;
    }
    try {
      await start.mutateAsync({
        sessionId,
        payload: {
          description: description.trim(),
          prompt: prompt.trim(),
          background,
        },
      });
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(`Unable to start orchestrator: ${errorMessage(toRunError(error))}`);
    }
  };
  return (
    <>
      <Tooltip title="Launch NAC orchestrator" position={TooltipPosition.TopCenter}>
        <Button
          size={ButtonSize.Small}
          variant={
            orchestrators.some((item) => item.status === "running")
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={ButtonContent.Icon}
          aria-label="Launch NAC orchestrator"
          onClick={() => setOpen(true)}
        >
          <Icon iconName={IconName.Flow} size={16} />
        </Button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size={ModalSize.Wide}
        title="Launch NAC orchestrator"
        subheader="Start a separate NAC planning session. Browse, steer, continue, and cancel it from Delegated work."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-small font-medium">New NAC orchestrator</div>
            </div>
            <Input
              label="Short description"
              inputSize={InputSize.Medium}
              placeholder="Implement the persistence slice"
              value={description}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextArea
              label="Complete objective"
              textAreaSize={TextAreaSize.Medium}
              placeholder="Describe scope, constraints, and expected verification"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              textAreaClassName="h-[112px] resize-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-small text-basic-secondary">
                <Switch checked={background} disabled={busy} onChange={setBackground} />
                Run in background
              </label>
              <Button
                variant={ButtonVariant.Primary}
                loading={start.isPending}
                disabled={busy}
                onClick={() => void submit()}
              >
                Start NAC orchestrator
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
