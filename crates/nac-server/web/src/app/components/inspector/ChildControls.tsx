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
import { useDelegatedPermissionStream } from "@/app/hooks/useSessionStream";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useStartTraditionalChild, useTraditionalChildren } from "@/app/services/queries";
import type { SessionBehavior, TraditionalChildRecord } from "@/app/types/api";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";

interface ChildControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

function ChildPermissionBridge({ child }: { child: TraditionalChildRecord }) {
  const running = child.status === "running";
  useDelegatedPermissionStream(child.child_session_id, running);
  if (!running) return null;
  return (
    <PermissionControls
      sessionId={child.child_session_id}
      behavior="direct"
      label={`Permissions for ${child.description}`}
    />
  );
}

/** Direct-primary controls for durable traditional child coding sessions. */
export function ChildControls({ sessionId, behavior }: ChildControlsProps) {
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const childrenQuery = useTraditionalChildren(sessionId, direct);
  const startChild = useStartTraditionalChild();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);

  // Descendant transcripts never render this composer path because ownership
  // resolves them as read-only before these controls mount.
  if (!direct) return null;

  const children = childrenQuery.data ?? [];
  const busy = startChild.isPending;
  const reset = () => {
    setDescription("");
    setPrompt("");
  };
  const submit = async () => {
    if (!description.trim() || !prompt.trim()) {
      toast.error("A short description and complete child prompt are required.");
      return;
    }
    try {
      await startChild.mutateAsync({
        sessionId,
        payload: {
          profile: "general",
          description: description.trim(),
          prompt: prompt.trim(),
          background,
        },
      });
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(`Unable to start child: ${errorMessage(toRunError(error))}`);
    }
  };
  return (
    <>
      {children.map((child) => (
        <ChildPermissionBridge key={child.child_session_id} child={child} />
      ))}
      <Tooltip title="Launch coding agent" position={TooltipPosition.TopCenter}>
        <Button
          size={ButtonSize.Small}
          variant={
            children.some((child) => child.status === "running")
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={ButtonContent.Icon}
          aria-label="Launch coding agent"
          onClick={() => setOpen(true)}
        >
          <Icon iconName={IconName.People} size={16} />
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size={ModalSize.Wide}
        title="Launch coding agent"
        subheader="Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Delegated work."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-small font-medium">New coding agent</div>
                <div className="mt-0.5 text-xs text-basic-tertiary">
                  General profile · read, write, edit, search, and terminal tools
                </div>
              </div>
            </div>
            <Input
              label="Short description"
              inputSize={InputSize.Medium}
              placeholder="Review persistence"
              value={description}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextArea
              label="Complete task prompt"
              textAreaSize={TextAreaSize.Medium}
              placeholder="Describe the task, relevant context, and expected verification"
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
                loading={startChild.isPending}
                disabled={busy}
                onClick={() => void submit()}
              >
                Start coding agent
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
