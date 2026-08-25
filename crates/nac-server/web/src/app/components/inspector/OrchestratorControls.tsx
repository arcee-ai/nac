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
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCancelManagedOrchestrator,
  useManagedOrchestrators,
  useStartManagedOrchestrator,
} from "@/app/services/queries";
import type { ManagedOrchestratorRecord, SessionBehavior } from "@/app/types/api";

interface OrchestratorControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

/** Internal durable NAC orchestration controls for the delegating direct behavior. */
export function OrchestratorControls({ sessionId, behavior }: OrchestratorControlsProps) {
  const enabled = behavior === "direct-with-orchestrator";
  const query = useManagedOrchestrators(sessionId, enabled);
  const start = useStartManagedOrchestrator();
  const cancelMutation = useCancelManagedOrchestrator();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ManagedOrchestratorRecord | null>(null);
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);

  if (!enabled || query.isError) return null;
  const orchestrators = query.data ?? [];
  const busy = start.isPending || cancelMutation.isPending;
  const reset = () => {
    setSelected(null);
    setDescription("");
    setPrompt("");
  };
  const select = (orchestrator: ManagedOrchestratorRecord) => {
    setSelected(orchestrator);
    setDescription(orchestrator.description);
    setPrompt("");
  };
  const submit = async () => {
    if (!description.trim() || !prompt.trim()) {
      toast.error("A short description and complete orchestration objective are required.");
      return;
    }
    try {
      const orchestrator = await start.mutateAsync({
        sessionId,
        payload: {
          description: description.trim(),
          prompt: prompt.trim(),
          ...(selected ? { orchestrator_session_id: selected.orchestrator_session_id } : {}),
          background,
        },
      });
      select(orchestrator);
    } catch (error) {
      toast.error(`Unable to start orchestrator: ${errorMessage(toRunError(error))}`);
    }
  };
  const cancel = async (orchestrator: ManagedOrchestratorRecord) => {
    try {
      await cancelMutation.mutateAsync({
        sessionId,
        orchestratorId: orchestrator.orchestrator_session_id,
      });
    } catch (error) {
      toast.error(`Unable to cancel orchestrator: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <>
      <Tooltip title="Managed orchestrators" position={TooltipPosition.TopCenter}>
        <Button
          size={ButtonSize.Small}
          variant={
            orchestrators.some((item) => item.status === "running")
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={ButtonContent.Icon}
          aria-label="Managed orchestrators"
          onClick={() => setOpen(true)}
        >
          <Icon iconName={IconName.Flow} size={16} />
        </Button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size={ModalSize.Wide}
        title="Managed orchestrators"
        subheader="Separate NAC planning sessions with their own worker threads. Background results return through this chat exactly once."
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-small font-medium">
                {selected ? `Continue ${selected.description}` : "New orchestrator"}
              </div>
              {selected ? (
                <Button size={ButtonSize.Small} variant={ButtonVariant.Ghost} onClick={reset}>
                  New orchestrator
                </Button>
              ) : null}
            </div>
            <Input
              label="Short description"
              inputSize={InputSize.Medium}
              placeholder="Implement the persistence slice"
              value={description}
              disabled={selected !== null}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
            <TextArea
              label={selected ? "Continuation or steering" : "Complete objective"}
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
                {selected ? "Continue orchestrator" : "Start orchestrator"}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="tag-label uppercase text-basic-secondary">Durable orchestrators</div>
            {query.isPending ? (
              <div className="py-4 text-center text-small text-basic-secondary">Loading…</div>
            ) : orchestrators.length === 0 ? (
              <div className="rounded-[4px] border border-border-primary p-3 text-small text-basic-tertiary">
                No orchestrator sessions yet.
              </div>
            ) : (
              orchestrators.map((orchestrator) => (
                <div
                  key={orchestrator.orchestrator_session_id}
                  className="rounded-[6px] border border-border-primary p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-small font-medium text-basic-primary">
                        {orchestrator.description}
                      </div>
                      <div className="mt-0.5 text-xs text-basic-tertiary">
                        {orchestrator.status.replaceAll("_", " ")} · generation{" "}
                        {orchestrator.generation}
                        {orchestrator.execution_mode ? ` · ${orchestrator.execution_mode}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size={ButtonSize.Small}
                        variant={ButtonVariant.Ghost}
                        onClick={() => select(orchestrator)}
                      >
                        {orchestrator.status === "running" ? "Steer" : "Continue"}
                      </Button>
                      <Button
                        size={ButtonSize.Small}
                        variant={ButtonVariant.Ghost}
                        onClick={() => {
                          setOpen(false);
                          navigate(routes.session(orchestrator.orchestrator_session_id));
                        }}
                      >
                        Open
                      </Button>
                      {orchestrator.status === "running" ? (
                        <Button
                          size={ButtonSize.Small}
                          variant={ButtonVariant.GhostDestructive}
                          disabled={busy}
                          onClick={() => void cancel(orchestrator)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {(orchestrator.failure ?? orchestrator.report) ? (
                    <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-basic-secondary">
                      {orchestrator.failure ?? orchestrator.report}
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
