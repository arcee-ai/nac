import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Modal,
  ModalSize,
  Switch,
  TextArea,
  TextAreaSize,
} from "@/app/atoms";
import {
  presentSessionAssignment,
  type DelegatedSessionPresentation,
} from "@/app/features/delegation/model";
import { DelegatedSessionRow } from "@/app/features/delegation/presentation/DelegatedSessionRow";
import {
  PanelEmpty,
  PanelLoading,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { toRunError } from "@/app/lib/providerError";
import { SESSION_PANEL_LABEL, routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCancelSessionSpawn,
  useSessionSpawns,
  useStartSessionSpawn,
} from "@/app/services/queries";
import { isAgentBehavior } from "@/app/lib/sessionBehavior";
import type { SessionBehavior } from "@/app/types/api";

function QueryError({ label, retry }: { label: string; retry: () => void }) {
  return (
    <div role="alert" className="rounded-[6px] border border-error-primary p-3">
      <div className="text-small text-error-primary">
        {label} could not be loaded.
      </div>
      <Button
        className="mt-2"
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        onClick={retry}
      >
        Try again
      </Button>
    </div>
  );
}

export function DelegatedWorkView({
  sessionId,
  behavior,
}: {
  sessionId: string;
  behavior: SessionBehavior;
}) {
  const enabled = isAgentBehavior(behavior);
  const assignments = useSessionSpawns(sessionId, enabled);
  const startSpawn = useStartSessionSpawn();
  const cancelSpawn = useCancelSessionSpawn();
  const toast = useToast();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promptTarget, setPromptTarget] =
    useState<DelegatedSessionPresentation | null>(null);
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);
  const rows = (assignments.data ?? []).map(presentSessionAssignment);
  if (selectedId === null && rows[0]) {
    setSelectedId(rows[0].id);
  } else if (
    selectedId != null &&
    rows.length > 0 &&
    !rows.some((row) => row.id === selectedId)
  ) {
    setSelectedId(rows[0]?.id ?? null);
  }
  const current = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const busy = startSpawn.isPending || cancelSpawn.isPending;

  const openPrompt = (row: DelegatedSessionPresentation) => {
    setPromptTarget(row);
    setPrompt("");
    setBackground(row.modeLabel !== "Foreground");
  };
  const submit = async () => {
    if (!promptTarget || !prompt.trim()) {
      toast.error("A continuation or steering prompt is required.");
      return;
    }
    try {
      await startSpawn.mutateAsync({
        sessionId,
        payload: {
          behavior:
            promptTarget.kind === "coding-agent" ? "direct" : "orchestrator",
          child_session_id: promptTarget.id,
          description: promptTarget.description,
          prompt: prompt.trim(),
          background,
        },
      });
      setPromptTarget(null);
      setPrompt("");
    } catch (error) {
      toast.error(
        `Unable to update delegated work: ${errorMessage(toRunError(error))}`,
      );
    }
  };
  const cancel = async (row: DelegatedSessionPresentation) => {
    try {
      await cancelSpawn.mutateAsync({ sessionId, childId: row.id });
    } catch (error) {
      toast.error(
        `Unable to cancel delegated work: ${errorMessage(toRunError(error))}`,
      );
    }
  };

  const list = !enabled ? (
    <div className="p-1 label-micro text-basic-muted">
      Orchestrator sessions do not own delegated work.
    </div>
  ) : assignments.isPending ? (
    <div role="status" className="p-1 text-small text-basic-secondary">
      Loading spawn sessions…
    </div>
  ) : assignments.isError ? (
    <QueryError
      label="Spawn sessions"
      retry={() => void assignments.refetch()}
    />
  ) : rows.length === 0 ? (
    <div className="p-1 label-micro text-basic-muted">
      None yet. Spawn an Agent or Orchestrator session from this chat.
    </div>
  ) : (
    rows.map((row) => (
      <PanelRow
        key={`${row.kind}:${row.id}`}
        label={row.description}
        active={row.id === current?.id}
        trailing={
          <span className="code code-micro text-basic-muted shrink-0">
            {row.statusLabel}
          </span>
        }
        onClick={() => setSelectedId(row.id)}
      />
    ))
  );

  if (!enabled) {
    return (
      <PanelSplit listTitle={SESSION_PANEL_LABEL.delegated} list={list}>
        <PanelEmpty>
          Orchestrator sessions do not own delegated work.
        </PanelEmpty>
      </PanelSplit>
    );
  }

  if (assignments.isPending && !assignments.data) {
    return <PanelLoading listTitle={SESSION_PANEL_LABEL.delegated} />;
  }

  return (
    <>
      <PanelSplit
        listTitle={SESSION_PANEL_LABEL.delegated}
        title={current?.description}
        list={list}
      >
        {current ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0">
            <DelegatedSessionRow
              session={current}
              busy={busy}
              onOpen={() => navigate(routes.session(current.id))}
              onPrompt={() => openPrompt(current)}
              onCancel={() => void cancel(current)}
            />
          </div>
        ) : (
          <PanelEmpty title="No spawn sessions yet.">
            They appear here as the agent starts them.
          </PanelEmpty>
        )}
      </PanelSplit>
      <Modal
        open={promptTarget != null}
        onClose={() => setPromptTarget(null)}
        size={ModalSize.Wide}
        title={
          promptTarget
            ? `${promptTarget.canSteer ? "Steer" : "Continue"} ${promptTarget.description}`
            : ""
        }
        subheader={
          promptTarget
            ? `${promptTarget.typeLabel} · generation ${promptTarget.generation}`
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <TextArea
            label={
              promptTarget?.canSteer
                ? "Steering message"
                : "Continuation prompt"
            }
            aria-label={
              promptTarget?.canSteer
                ? "Steering message"
                : "Continuation prompt"
            }
            textAreaSize={TextAreaSize.Medium}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            textAreaClassName="h-[140px] resize-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-small text-basic-secondary">
              <Switch
                checked={background}
                disabled={busy}
                onChange={setBackground}
              />
              Run in background
            </label>
            <Button
              variant={ButtonVariant.Primary}
              loading={startSpawn.isPending}
              disabled={busy}
              onClick={() => void submit()}
            >
              {promptTarget?.canSteer ? "Send steering" : "Continue"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
