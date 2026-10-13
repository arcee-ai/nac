import { useId } from "react";
import { Button, ButtonVariant, Modal, ModalSize } from "@/app/atoms";
import type { ReviewSnapshot, SelectionReviewController } from "./reviewController";

export interface ReviewAvailability {
  readonly mode: "idle" | "busy" | "unknown";
  readonly runId?: string;
  readonly sourceAlive?: boolean;
  readonly sourceUnavailable?: boolean;
}
interface Props {
  readonly state: ReviewSnapshot;
  readonly controller: SelectionReviewController;
  readonly availability: ReviewAvailability;
}

/** Displays only server-normalized reviewed evidence; no transport or storage. */
export function SelectionReview({ state, controller, availability }: Props) {
  const id = useId();
  const sending = state.phase === "sending";
  const locked = sending || state.phase === "uncertain" || state.phase === "accepted";
  const editing = state.phase === "editing";
  const targetChanged =
    state.choice.delivery === "steer" && state.choice.runId !== availability.runId;
  const canSubmit =
    state.phase === "reviewed" &&
    !availability.sourceUnavailable &&
    (state.choice.delivery === "queue" ||
      (state.choice.delivery === "send" && availability.mode === "idle") ||
      (state.choice.delivery === "steer" &&
        availability.mode === "busy" &&
        !!availability.runId &&
        !targetChanged));
  const label =
    state.choice.delivery === "queue"
      ? "Queue selection"
      : state.choice.delivery === "steer"
        ? "Steer selected run"
        : "Send selection";
  return (
    <Modal
      open={state.phase !== "empty"}
      title="Review terminal selection"
      size={ModalSize.Large}
      onClose={sending ? undefined : () => controller.clear()}
      onNavigate={() => controller.clear()}
      closeOnOverlay={!sending}
      footer={
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            type="button"
            variant={ButtonVariant.Ghost}
            disabled={sending}
            onClick={() => controller.clear()}
          >
            {state.phase === "uncertain" ? "Dismiss unconfirmed submission" : "Dismiss review"}
          </Button>
          {state.phase !== "accepted" ? (
            <Button
              type="button"
              variant={ButtonVariant.Secondary}
              disabled={sending}
              onClick={() => controller.clear()}
            >
              Clear selection review
            </Button>
          ) : null}
          {state.phase === "uncertain" ? (
            <Button type="button" onClick={() => void controller.retry()}>
              Retry same submission
            </Button>
          ) : state.phase !== "accepted" ? (
            <Button
              type="button"
              disabled={!canSubmit}
              loading={sending}
              onClick={() => void controller.send()}
            >
              {sending ? "Sending selection…" : label}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Only this selected text and optional accompanying text will be shared as literal,
          untrusted evidence. Reviewing does not send anything to the agent.
        </p>
        {state.source ? (
          <details>
            <summary>Selection source</summary>
            <p className="break-all">Chat: {state.source.sessionId}</p>
            <p className="break-all">Shell: {state.source.terminalId}</p>
            <p>Client capture time: {state.source.capturedAtMs} ms</p>
          </details>
        ) : null}
        {availability.sourceAlive === false ? (
          <p role="status">
            The source shell has exited. This frozen selection can still be shared while its
            retained source remains available.
          </p>
        ) : state.source && !state.source.sourceAlive ? (
          <p role="status">The shell’s running state was not confirmed at capture.</p>
        ) : null}
        {availability.sourceUnavailable ? (
          <p role="alert">
            The source is currently unavailable. A new send is disabled; an unconfirmed submission
            can still be reconciled with its original identity.
          </p>
        ) : null}
        {state.error ? <p role="alert">{state.error}</p> : null}
        {state.phase === "uncertain" ? (
          <p>
            Dismissing or clearing this review does not cancel accepted work. Check history before
            sending a new copy.
          </p>
        ) : null}
        {state.phase === "previewing" ? (
          <p role="status">Preparing the server-normalized preview…</p>
        ) : null}
        {state.preview ? (
          <div className="flex flex-col gap-2">
            <h3>Reviewed selected text</h3>
            <pre
              aria-label="Reviewed selected text"
              className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3"
            >
              {state.preview.text}
            </pre>
            <p>
              {state.preview.text_scalars.toLocaleString()} characters ·{" "}
              {state.preview.text_utf8_bytes.toLocaleString()} UTF-8 bytes. No truncation.
            </p>
          </div>
        ) : null}
        {editing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-question`}>Accompanying literal text (optional)</label>
            <textarea
              id={`${id}-question`}
              value={state.editorText}
              rows={4}
              onChange={(event) => controller.setUserText(event.target.value)}
              className="rounded bg-bg-elevation-level-1 p-3"
            />
            <p>
              Update the preview before sending. Limits apply separately to selected and
              accompanying text.
            </p>
            <Button
              type="button"
              variant={ButtonVariant.Secondary}
              onClick={() => void controller.preview()}
            >
              Update preview
            </Button>
          </div>
        ) : !locked && state.preview ? (
          <Button
            type="button"
            variant={ButtonVariant.Ghost}
            onClick={() => controller.editUserText()}
          >
            Edit accompanying text
          </Button>
        ) : null}
        {!editing && state.preview?.user_text != null ? (
          <div>
            <h3>Reviewed accompanying text</h3>
            <pre
              aria-label="Reviewed accompanying text"
              className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3"
            >
              {state.preview.user_text}
            </pre>
          </div>
        ) : null}
        {state.phase === "error" && state.canPreview ? (
          <Button
            type="button"
            variant={ButtonVariant.Secondary}
            onClick={() => void controller.preview()}
          >
            Retry preview
          </Button>
        ) : null}
        <fieldset disabled={locked} className="flex flex-col gap-2">
          <legend className="mb-2">Delivery</legend>
          <label>
            <input
              type="radio"
              name={`${id}-delivery`}
              checked={state.choice.delivery === "send"}
              disabled={availability.mode !== "idle"}
              onChange={() => controller.choose({ delivery: "send" })}
            />{" "}
            Send as a new turn (idle chat)
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-delivery`}
              checked={state.choice.delivery === "queue"}
              onChange={() => controller.choose({ delivery: "queue" })}
            />{" "}
            Queue after existing input
          </label>
          <p>When idle, queued evidence may start the next turn.</p>
          <label>
            <input
              type="radio"
              name={`${id}-delivery`}
              checked={state.choice.delivery === "steer" && !targetChanged}
              disabled={!availability.runId || availability.mode !== "busy"}
              onChange={() => controller.choose({ delivery: "steer", runId: availability.runId })}
            />{" "}
            Steer the displayed active run
            {availability.runId ? ` (${availability.runId.slice(0, 8)})` : ""}
          </label>
        </fieldset>
        {targetChanged ? (
          <p role="alert">
            The selected run ended or changed. Choose Queue or explicitly choose the displayed run
            again; this selection will not be retargeted automatically.
          </p>
        ) : null}
        {state.phase === "reviewed" &&
        state.choice.delivery === "send" &&
        availability.mode !== "idle" ? (
          <p role="status">
            The chat is busy or its state is unknown. Choose a delivery option before sending.
          </p>
        ) : null}
        {sending ? (
          <p role="status">
            Admission is in progress. Leaving this view does not cancel accepted work.
          </p>
        ) : null}
        {state.receipt ? (
          <p role="status">
            {state.receipt.replayed
              ? "Existing admission reconciled."
              : "Selection admission accepted."}{" "}
            Current inbox status: {state.receipt.status}. Original choice:{" "}
            {state.receipt.accepted_intent.initial_delivery}; current delivery:{" "}
            {state.receipt.current_delivery}.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
