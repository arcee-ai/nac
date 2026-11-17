import { useCallback, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import type { SessionSnapshotResponse } from "@/app/types/api";

import {
  useAskSelectionQuestion,
  useCancelSelectionQuestion,
  useSelectionQuestions,
} from "./queries";
import { SelectionQuestionPane, type SelectionReviewDraft } from "./SelectionQuestionPane";
import { bindSelection, MAX_EXCERPT_CHARS, sha256Hex } from "./selectionBinding";
import { useTranscriptSelection } from "./useTranscriptSelection";

/** A canonical v4 UUID, also where `crypto.randomUUID` needs a secure context. */
function requestKey(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface Review extends SelectionReviewDraft {
  requestKey: string;
  contentSha256: string;
  start: number;
  end: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failure with an HTTP status was answered; anything else may have landed. */
function answeredByServer(error: unknown): boolean {
  return typeof (error as { status?: unknown } | null)?.status === "number";
}

interface Props {
  sessionId: string;
  messages: SessionSnapshotResponse["messages"];
  /** Raw snapshot index of `messages[0]`. */
  windowStart: number;
  /** The transcript region whose completed replies can be selected. */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * Ask about selected reply text: the affordance beside a selection, the
 * review, and the answer pane. Independent of the chat's run, composer and
 * inbox; it only ever talks to the selection-question routes.
 */
export function SelectionQuestions({ sessionId, messages, windowStart, containerRef }: Props) {
  const [selection, clearSelection] = useTranscriptSelection(containerRef, true);
  const [review, setReview] = useState<Review | null>(null);
  const [open, setOpen] = useState(false);
  const history = useSelectionQuestions(sessionId, true);
  const ask = useAskSelectionQuestion(sessionId);
  const cancel = useCancelSelectionQuestion(sessionId);
  const questions = history.data?.items ?? [];

  const startReview = useCallback(() => {
    if (!selection) return;
    const message = messages[selection.messageIndex - windowStart];
    const content = message?.role === "assistant" ? (message.content ?? "") : "";
    const binding = content ? bindSelection(content, selection.text, selection.hint) : null;
    const tooLong = binding != null && Array.from(binding.excerpt).length > MAX_EXCERPT_CHARS;
    setReview({
      messageIndex: selection.messageIndex,
      excerpt: binding?.excerpt ?? selection.text.trim(),
      question: "",
      error: !binding
        ? "This selection could not be matched to the reply’s text. Select plain text or code within one reply."
        : tooLong
          ? `Select at most ${MAX_EXCERPT_CHARS.toLocaleString()} characters.`
          : null,
      uncertain: false,
      blocked: !binding || tooLong,
      sending: false,
      requestKey: requestKey(),
      contentSha256: sha256Hex(content),
      start: binding?.start ?? 0,
      end: binding?.end ?? 0,
    });
    setOpen(true);
    clearSelection();
    window.getSelection()?.removeAllRanges();
  }, [clearSelection, messages, selection, windowStart]);

  const submit = useCallback(() => {
    if (!review) return;
    const current = review;
    setReview({ ...current, sending: true, error: null });
    ask
      .mutateAsync({
        request_key: current.requestKey,
        source_message_index: current.messageIndex,
        source_content_sha256: current.contentSha256,
        selection_start: current.start,
        selection_end: current.end,
        excerpt: current.excerpt,
        question: current.question,
      })
      .then(() => setReview(null))
      .catch((error: unknown) =>
        setReview({
          ...current,
          sending: false,
          // An unanswered request may have been admitted: retrying sends the
          // same key, which returns that question instead of a second one.
          uncertain: !answeredByServer(error),
          error: answeredByServer(error)
            ? errorText(error)
            : "The question may not have reached the server. Retry to check without asking twice.",
        }),
      );
  }, [ask, review]);

  return (
    <>
      {selection && !review
        ? // Portaled: a transformed ancestor would otherwise re-anchor `fixed`.
          createPortal(
            <div
              className="fixed z-50"
              style={{
                top: Math.min(Math.max(selection.top + 6, 8), window.innerHeight - 48),
                left: Math.min(Math.max(selection.left, 8), window.innerWidth - 200),
              }}
            >
              <Button
                type="button"
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                // Keep the selection alive through the press.
                onMouseDown={(event) => event.preventDefault()}
                onClick={startReview}
              >
                Ask about selection
              </Button>
            </div>,
            document.body,
          )
        : null}
      {open || review ? (
        <div className="pointer-events-none absolute right-4 bottom-[160px] z-20 md:right-8">
          <SelectionQuestionPane
            review={review}
            questions={questions}
            cancelingId={cancel.isPending ? (cancel.variables ?? null) : null}
            onQuestionChange={(question) =>
              setReview((current) =>
                current
                  ? {
                      ...current,
                      question,
                      // Changed arguments are a new question with a new key.
                      requestKey: current.question === question ? current.requestKey : requestKey(),
                      uncertain: false,
                      error: current.blocked ? current.error : null,
                    }
                  : current,
              )
            }
            onAsk={submit}
            onDiscard={() => setReview(null)}
            onCancel={(questionId) => cancel.mutate(questionId)}
            onClose={() => {
              setReview(null);
              setOpen(false);
            }}
          />
        </div>
      ) : questions.length > 0 ? (
        <div className="absolute right-4 bottom-[160px] z-20 md:right-8">
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            onClick={() => setOpen(true)}
          >
            {`Selection questions (${questions.length})`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
