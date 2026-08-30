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
import { toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
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
      <div className="text-small text-error-primary">{label} could not be loaded.</div>
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

function Empty({ children }: { children: string }) {
  return (
    <div className="rounded-[6px] border border-border-primary p-3 text-small text-basic-tertiary">
      {children}
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
  const [selected, setSelected] = useState<DelegatedSessionPresentation | null>(null);
  const [prompt, setPrompt] = useState("");
  const [background, setBackground] = useState(true);
  const rows = (assignments.data ?? []).map(presentSessionAssignment);
  const busy = startSpawn.isPending || cancelSpawn.isPending;

  const openPrompt = (row: DelegatedSessionPresentation) => {
    setSelected(row);
    setPrompt("");
    setBackground(row.modeLabel !== "Foreground");
  };
  const submit = async () => {
    if (!selected || !prompt.trim()) {
      toast.error("A continuation or steering prompt is required.");
      return;
    }
    try {
      await startSpawn.mutateAsync({
        sessionId,
        payload: {
          behavior: selected.kind === "coding-agent" ? "direct" : "orchestrator",
          child_session_id: selected.id,
          description: selected.description,
          prompt: prompt.trim(),
          background,
        },
      });
      setSelected(null);
      setPrompt("");
    } catch (error) {
      toast.error(`Unable to update delegated work: ${errorMessage(toRunError(error))}`);
    }
  };
  const cancel = async (row: DelegatedSessionPresentation) => {
    try {
      await cancelSpawn.mutateAsync({ sessionId, childId: row.id });
    } catch (error) {
      toast.error(`Unable to cancel delegated work: ${errorMessage(toRunError(error))}`);
    }
  };
  const renderRow = (row: DelegatedSessionPresentation) => (
    <DelegatedSessionRow
      key={`${row.kind}:${row.id}`}
      session={row}
      busy={busy}
      onOpen={() => navigate(routes.session(row.id))}
      onPrompt={() => openPrompt(row)}
      onCancel={() => void cancel(row)}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto p-3">
      <div>
        <h2 className="header-small text-basic-primary">Delegated work</h2>
        <p className="mt-1 text-small text-basic-secondary">
          Live parent-owned work. Open a read-only transcript, steer a running session, continue a
          finished generation, or cancel active work here.
        </p>
      </div>
      <section aria-labelledby="delegated-work-heading" className="flex flex-col gap-2">
        <h3 id="delegated-work-heading" className="tag-label uppercase text-basic-secondary">
          Assignments
        </h3>
        {!enabled ? (
          <Empty>NAC sessions do not own delegated work.</Empty>
        ) : assignments.isPending ? (
          <div role="status" className="text-small text-basic-secondary">
            Loading delegated work…
          </div>
        ) : assignments.isError ? (
          <QueryError label="Delegated work" retry={() => void assignments.refetch()} />
        ) : rows.length ? (
          rows.map(renderRow)
        ) : (
          <Empty>None yet. Spawn an Agent or NAC session from this chat.</Empty>
        )}
      </section>
      <Modal
        open={selected != null}
        onClose={() => setSelected(null)}
        size={ModalSize.Wide}
        title={
          selected ? `${selected.canSteer ? "Steer" : "Continue"} ${selected.description}` : ""
        }
        subheader={
          selected ? `${selected.typeLabel} · generation ${selected.generation}` : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <TextArea
            label={selected?.canSteer ? "Steering message" : "Continuation prompt"}
            aria-label={selected?.canSteer ? "Steering message" : "Continuation prompt"}
            textAreaSize={TextAreaSize.Medium}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            textAreaClassName="h-[140px] resize-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-small text-basic-secondary">
              <Switch checked={background} disabled={busy} onChange={setBackground} />
              Run in background
            </label>
            <Button
              variant={ButtonVariant.Primary}
              loading={startSpawn.isPending}
              disabled={busy}
              onClick={() => void submit()}
            >
              {selected?.canSteer ? "Send steering" : "Continue"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
