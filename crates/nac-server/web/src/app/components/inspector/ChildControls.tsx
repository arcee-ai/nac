import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
import { routes } from "@/app/lib/routes";
import { useDelegatedPermissionStream } from "@/app/hooks/useSessionStream";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCancelTraditionalChild,
  useStartTraditionalChild,
  useTraditionalChildren,
} from "@/app/services/queries";
import type {
  SessionBehavior,
  TraditionalChildRecord,
  TraditionalChildStatus,
} from "@/app/types/api";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";

interface ChildControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

function statusLabel(status: TraditionalChildStatus): string {
  return status.replaceAll("_", " ");
}

function outcome(child: TraditionalChildRecord): string | null {
  return child.failure ?? child.report ?? child.change_summary ?? child.verification_summary;
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
  const cancelChild = useCancelTraditionalChild();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TraditionalChildRecord | null>(null);
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);

  // A child session is behavior=direct too, but its list endpoint rejects the
  // depth-one relationship. Hiding on that response keeps recursion out of the UI.
  if (!direct || childrenQuery.isError) return null;

  const children = childrenQuery.data ?? [];
  const busy = startChild.isPending || cancelChild.isPending;
  const reset = () => {
    setSelected(null);
    setDescription("");
    setPrompt("");
  };
  const continueChild = (child: TraditionalChildRecord) => {
    setSelected(child);
    setDescription(child.description);
    setPrompt("");
  };
  const submit = async () => {
    if (!description.trim() || !prompt.trim()) {
      toast.error("A short description and complete child prompt are required.");
      return;
    }
    try {
      const child = await startChild.mutateAsync({
        sessionId,
        payload: {
          profile: "general",
          description: description.trim(),
          prompt: prompt.trim(),
          ...(selected ? { child_session_id: selected.child_session_id } : {}),
          background,
        },
      });
      setSelected(child);
      setDescription(child.description);
      setPrompt("");
    } catch (error) {
      toast.error(`Unable to start child: ${errorMessage(toRunError(error))}`);
    }
  };
  const cancel = async (child: TraditionalChildRecord) => {
    try {
      await cancelChild.mutateAsync({ sessionId, childId: child.child_session_id });
    } catch (error) {
      toast.error(`Unable to cancel child: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <>
      {children.map((child) => (
        <ChildPermissionBridge key={child.child_session_id} child={child} />
      ))}
      <Tooltip title="Child sessions" position={TooltipPosition.TopCenter}>
        <Button
          size={ButtonSize.Small}
          variant={
            children.some((child) => child.status === "running")
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={ButtonContent.Icon}
          aria-label="Durable child sessions"
          onClick={() => setOpen(true)}
        >
          <Icon iconName={IconName.People} size={16} />
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size={ModalSize.Wide}
        title="Child sessions"
        subheader="Fresh-context coding agents with the same model, workspace, and permission ceiling. Background results return through this chat automatically."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-small font-medium">
                  {selected ? `Continue ${selected.description}` : "New general child"}
                </div>
                <div className="mt-0.5 text-xs text-basic-tertiary">
                  General profile · read, write, edit, search, and terminal tools
                </div>
              </div>
              {selected ? (
                <Button size={ButtonSize.Small} variant={ButtonVariant.Ghost} onClick={reset}>
                  New child
                </Button>
              ) : null}
            </div>
            <Input
              label="Short description"
              inputSize={InputSize.Medium}
              placeholder="Review persistence"
              value={description}
              disabled={selected !== null}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextArea
              label={selected ? "Continuation or steering" : "Complete task prompt"}
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
                {selected ? "Continue child" : "Start child"}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="tag-label uppercase text-basic-secondary">Durable children</div>
            {childrenQuery.isPending ? (
              <div className="py-4 text-center text-small text-basic-secondary">Loading…</div>
            ) : children.length === 0 ? (
              <div className="rounded-[4px] border border-border-primary p-3 text-small text-basic-tertiary">
                No child sessions yet.
              </div>
            ) : (
              children.map((child) => (
                <div
                  key={child.child_session_id}
                  className="rounded-[6px] border border-border-primary p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-small font-medium text-basic-primary">
                        {child.description}
                      </div>
                      <div className="mt-0.5 text-xs text-basic-tertiary">
                        {statusLabel(child.status)} · generation {child.generation}
                        {child.execution_mode ? ` · ${child.execution_mode}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size={ButtonSize.Small}
                        variant={ButtonVariant.Ghost}
                        onClick={() => continueChild(child)}
                      >
                        {child.status === "running" ? "Steer" : "Continue"}
                      </Button>
                      <Button
                        size={ButtonSize.Small}
                        variant={ButtonVariant.Ghost}
                        onClick={() => {
                          setOpen(false);
                          navigate(routes.session(child.child_session_id));
                        }}
                      >
                        Open
                      </Button>
                      {child.status === "running" ? (
                        <Button
                          size={ButtonSize.Small}
                          variant={ButtonVariant.GhostDestructive}
                          disabled={busy}
                          onClick={() => void cancel(child)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {outcome(child) ? (
                    <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-basic-secondary">
                      {outcome(child)}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
