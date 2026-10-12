import { Effect } from "effect";
import type { NativeApi } from "@/app/services/api";
import type {
  TerminalSelectionPreviewResponse,
  TerminalSelectionSubmissionRequest,
  TerminalSelectionSubmissionResponse,
  TerminalSelectionDelivery,
} from "@/app/types/api";

import type { TerminalSelectionCapture } from "@/app/features/terminal/TerminalPane";
import {
  openSelectionOperation,
  previewSelection,
  submitSelection,
  type SelectionOperation,
} from "./reviewWorkflow";

/** The pane snapshots rendered text only at an explicit user capture point. */
export type SelectionCapture = TerminalSelectionCapture;
export type SelectionSource = Omit<SelectionCapture, "selectedText">;
export interface DeliveryChoice {
  readonly delivery: TerminalSelectionDelivery;
  readonly runId?: string;
}
export interface ReviewSnapshot {
  readonly phase:
    | "empty"
    | "previewing"
    | "editing"
    | "reviewed"
    | "sending"
    | "uncertain"
    | "accepted"
    | "error";
  readonly source?: SelectionSource;
  readonly editorText: string;
  readonly canPreview?: boolean;
  readonly preview?: TerminalSelectionPreviewResponse;
  readonly choice: DeliveryChoice;
  readonly error?: string;
  readonly receipt?: TerminalSelectionSubmissionResponse;
}
interface ReviewPorts {
  readonly sessionId: string;
  readonly api: Pick<NativeApi, "previewUserTerminalSelection" | "submitUserTerminalSelection">;
  readonly captureActivation: () => () => boolean;
  readonly accepted: () => void;
  readonly unconfirmed?: () => void;
}
const EMPTY = Object.freeze<ReviewSnapshot>({
  phase: "empty",
  editorText: "",
  choice: { delivery: "send" },
});
const MAX_BYTES = 32768;
const MAX_SCALARS = 8192;
function bounded(text: string): boolean {
  let scalars = 0;
  const characters = text[Symbol.iterator]();
  while (!characters.next().done) if (++scalars > MAX_SCALARS) return false;
  return new TextEncoder().encode(text).byteLength <= MAX_BYTES;
}

/** Private ephemeral originals; only canonical previews enter the public snapshot.
 * No request variables or draft text are retained in a query/mutation cache.
 */
export class SelectionReviewController {
  #snapshot: ReviewSnapshot = EMPTY;
  #capture?: Readonly<SelectionCapture>;
  #captureId?: string;
  #question?: string;
  #submission?: Readonly<TerminalSelectionSubmissionRequest>;
  #request?: SelectionOperation;
  #disposed = false;
  #retained = 0;
  #detachVersion = 0;
  #listeners = new Set<() => void>();
  constructor(private readonly ports: ReviewPorts) {}
  readonly getSnapshot = () => this.#snapshot;
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  /** A same-chat reset settles local request state without applying old results. */
  readonly checkActivation = () => {
    if (!this.#request || this.#request.activationCurrent()) return;
    this.#interrupt();
  };
  #interrupt() {
    this.#closeRequest();
    if (this.#snapshot.phase === "sending" && this.#submission) {
      this.#set({
        ...this.#snapshot,
        phase: "uncertain",
        error:
          "The chat view was reset before submission was confirmed. It may already be accepted. Retry keeps the exact reviewed intent and submission identity.",
      });
    } else if (this.#snapshot.phase === "previewing") {
      this.#set({
        ...this.#snapshot,
        phase: "error",
        error:
          "The chat view was reset before preview was confirmed. Retry the preview explicitly; nothing was sent.",
      });
    }
  }
  readonly retain = () => {
    this.#retained += 1;
    this.#detachVersion += 1;
    return () => {
      this.#retained -= 1;
      // StrictMode cleanup closes request resources before replacement activation.
      if (!this.#retained) this.#interrupt();
      const version = ++this.#detachVersion;
      queueMicrotask(() => {
        if (!this.#retained && this.#detachVersion === version) this.dispose();
      });
    };
  };
  #set(snapshot: ReviewSnapshot) {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) listener();
  }
  capture(capture: Readonly<SelectionCapture>, choice: DeliveryChoice) {
    if (this.#disposed) return;
    if (this.#snapshot.phase !== "empty" && this.#snapshot.phase !== "accepted") {
      this.#set({
        ...this.#snapshot,
        error: "Finish or clear the current selection review before capturing another.",
      });
      return;
    }
    this.clear();
    const selectedText = capture.selectedText;
    const source = Object.freeze({
      sessionId: capture.sessionId,
      terminalId: capture.terminalId,
      capturedAtMs: capture.capturedAtMs,
      sourceAlive: capture.sourceAlive,
    });
    if (
      capture.sessionId !== this.ports.sessionId ||
      !selectedText.trim() ||
      !bounded(selectedText)
    ) {
      this.#set({
        ...EMPTY,
        source,
        phase: "error",
        error:
          "Select visible text within 32 KiB and 8,192 characters from this chat. Nothing was truncated or sent.",
      });
      return;
    }
    this.#capture = Object.freeze({ ...source, selectedText });
    this.#captureId = crypto.randomUUID();
    this.#set({
      source: Object.freeze(source),
      phase: "editing",
      canPreview: true,
      editorText: "",
      choice: Object.freeze({ ...choice }),
    });
    void this.preview();
  }
  setUserText(text: string) {
    if (!this.#capture || ["sending", "uncertain", "accepted"].includes(this.#snapshot.phase))
      return;
    if (!bounded(text)) {
      this.#set({
        ...this.#snapshot,
        error:
          "Accompanying text exceeds 32 KiB or 8,192 characters. That edit was rejected without truncation.",
      });
      return;
    }
    this.#closeRequest();
    this.#question = text === "" ? undefined : text;
    this.#set({ ...this.#snapshot, phase: "editing", editorText: text, error: undefined });
  }
  editUserText() {
    if (!this.#capture || ["sending", "uncertain", "accepted"].includes(this.#snapshot.phase))
      return;
    this.#closeRequest();
    this.#set({
      ...this.#snapshot,
      phase: "editing",
      editorText: this.#question ?? "",
      error: undefined,
    });
  }
  choose(choice: DeliveryChoice) {
    if (["sending", "uncertain", "accepted"].includes(this.#snapshot.phase)) return;
    this.#set({ ...this.#snapshot, choice: Object.freeze({ ...choice }), error: undefined });
  }
  #closeRequest() {
    const request = this.#request;
    this.#request = undefined;
    request?.close();
  }
  #openRequest() {
    this.#closeRequest();
    const operation = openSelectionOperation(this.ports.captureActivation());
    this.#request = operation;
    return operation;
  }
  #apply(operation: SelectionOperation, update: () => void) {
    if (this.#disposed || this.#request !== operation) return;
    if (!operation.current()) {
      this.checkActivation();
      return;
    }
    this.#request = undefined;
    update();
  }
  async preview() {
    const capture = this.#capture;
    const captureId = this.#captureId;
    if (
      !capture ||
      !captureId ||
      ["sending", "uncertain", "accepted"].includes(this.#snapshot.phase)
    )
      return;
    const operation = this.#openRequest();
    const body = {
      protocol_version: 1 as const,
      capture_id: captureId,
      client_capture_time_ms: capture.capturedAtMs,
      selected_text: capture.selectedText,
      user_text: this.#question,
    };
    await Effect.runPromise(
      previewSelection({
        operation,
        started: () =>
          this.#set({ ...this.#snapshot, phase: "previewing", editorText: "", error: undefined }),
        request: (signal) =>
          this.ports.api.previewUserTerminalSelection(
            capture.sessionId,
            capture.terminalId,
            body,
            signal,
          ),
        confirmed: (preview) =>
          this.#apply(operation, () =>
            this.#set({
              ...this.#snapshot,
              phase: "reviewed",
              preview: Object.freeze(preview),
              editorText: "",
              error: undefined,
            }),
          ),
        failed: () =>
          this.#apply(operation, () =>
            this.#set({
              ...this.#snapshot,
              phase: "error",
              editorText: "",
              error:
                "This source could not provide a valid selection preview. It may be unavailable or the text may exceed its bounds. Nothing was sent.",
            }),
          ),
      }),
    );
  }
  async send() {
    const capture = this.#capture;
    const preview = this.#snapshot.preview;
    if (!capture || !preview || this.#snapshot.phase !== "reviewed") return;
    const choice = this.#snapshot.choice;
    if (choice.delivery === "steer" && !choice.runId) return;
    this.#submission = Object.freeze({
      protocol_version: 1,
      admission_id: crypto.randomUUID(),
      capture_id: preview.capture_id,
      client_capture_time_ms: capture.capturedAtMs,
      expected_owner_instance_id: preview.owner_instance_id,
      original_selected_text: capture.selectedText,
      expected_selection_text: preview.text,
      original_user_text: this.#question,
      expected_user_text: preview.user_text,
      delivery: choice.delivery,
      expected_run_id: choice.delivery === "steer" ? choice.runId : undefined,
    });
    await this.#submit(this.#submission, capture);
  }
  async retry() {
    if (this.#snapshot.phase !== "uncertain" || !this.#submission || !this.#capture) return;
    await this.#submit(this.#submission, this.#capture);
  }
  async #submit(
    body: Readonly<TerminalSelectionSubmissionRequest>,
    capture: Readonly<SelectionCapture>,
  ) {
    const operation = this.#openRequest();
    await Effect.runPromise(
      submitSelection({
        operation,
        started: () => this.#set({ ...this.#snapshot, phase: "sending", error: undefined }),
        request: (signal) =>
          this.ports.api.submitUserTerminalSelection(
            capture.sessionId,
            capture.terminalId,
            body,
            signal,
          ),
        accepted: this.ports.accepted,
        unconfirmed: () => this.ports.unconfirmed?.(),
        confirmed: (receipt) =>
          this.#apply(operation, () => {
            this.#capture = undefined;
            this.#question = undefined;
            this.#submission = undefined;
            this.#set({
              ...this.#snapshot,
              phase: "accepted",
              receipt: Object.freeze(receipt),
              editorText: "",
              error: undefined,
            });
          }),
        failed: () =>
          this.#apply(operation, () =>
            this.#set({
              ...this.#snapshot,
              phase: "uncertain",
              error:
                "Submission was not confirmed and may already be accepted. Retry uses this exact reviewed text, delivery choice and submission identity.",
            }),
          ),
      }),
    );
  }
  clear() {
    this.#closeRequest();
    this.#capture = undefined;
    this.#captureId = undefined;
    this.#question = undefined;
    this.#submission = undefined;
    this.#set(EMPTY);
  }
  dispose() {
    if (this.#disposed) return;
    this.clear();
    this.#disposed = true;
    this.#listeners.clear();
  }
}
