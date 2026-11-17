import { useId } from "react";

import { Button, ButtonSize, ButtonVariant, TextArea, TextAreaSize } from "@/app/atoms";
import { Markdown } from "@/app/lib/markdown";
import type { SelectionQuestion } from "@/app/types/api";

import { MAX_QUESTION_CHARS } from "./selectionBinding";

export interface SelectionReviewDraft {
  /** Transcript index of the reply the excerpt came from. */
  messageIndex: number;
  excerpt: string;
  question: string;
  /** Why the review cannot be sent, or why the last attempt failed. */
  error: string | null;
  /** The last send's outcome is unknown; Ask resends the same request key. */
  uncertain: boolean;
  /** The selection itself cannot be asked about; only Discard applies. */
  blocked: boolean;
  sending: boolean;
}

interface Props {
  review: SelectionReviewDraft | null;
  questions: SelectionQuestion[];
  cancelingId: string | null;
  onQuestionChange: (question: string) => void;
  onAsk: () => void;
  onDiscard: () => void;
  onCancel: (questionId: string) => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<SelectionQuestion["status"], string> = {
  pending: "Answering…",
  answered: "Answered",
  failed: "No answer",
  canceled: "Canceled",
  interrupted: "Interrupted",
};

function usageLine(question: SelectionQuestion): string | null {
  const usage = question.usage;
  if (!usage) return null;
  return `${usage.input_tokens.toLocaleString()} in · ${usage.output_tokens.toLocaleString()} out tokens, counted separately from this chat`;
}

function QuestionCard({
  question,
  canceling,
  onCancel,
}: {
  question: SelectionQuestion;
  canceling: boolean;
  onCancel: (questionId: string) => void;
}) {
  const usage = usageLine(question);
  return (
    <article
      aria-label={`Question about selection: ${question.question}`}
      className="flex flex-col gap-2 rounded-[8px] border border-muted p-3"
    >
      <blockquote className="max-h-[72px] overflow-auto border-l-2 border-muted pl-2 label-small text-basic-muted whitespace-pre-wrap">
        {question.excerpt}
      </blockquote>
      <p className="label-small font-medium">{question.question}</p>
      <p role="status" className="label-2xs text-basic-muted">
        {STATUS_LABEL[question.status]}
        {question.tool_call_attempted ? " · the model tried to use a tool; nothing was run" : ""}
      </p>
      {question.answer ? (
        <div className="label-small">
          <Markdown className="[&>:first-child]:!mt-0 [&>:last-child]:!mb-0">
            {question.answer}
          </Markdown>
          {question.answer_truncated ? (
            <p className="label-2xs text-basic-muted">The answer was shortened to fit.</p>
          ) : null}
        </div>
      ) : null}
      {question.error ? <p className="label-small text-basic-muted">{question.error}</p> : null}
      <p className="label-2xs text-basic-muted">
        About reply #{question.source.message_index} · {question.model.model}
        {usage ? ` · ${usage}` : ""}
      </p>
      {question.status === "pending" ? (
        <div>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            disabled={canceling}
            onClick={() => onCancel(question.question_id)}
          >
            Cancel question
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * A compact pane beside the chat: review a selected excerpt, ask one
 * question about it, and read attributed answers. Nothing here sends input
 * to the chat itself.
 */
export function SelectionQuestionPane({
  review,
  questions,
  cancelingId,
  onQuestionChange,
  onAsk,
  onDiscard,
  onCancel,
  onClose,
}: Props) {
  const id = useId();
  const newestFirst = [...questions].reverse();
  const canAsk =
    review != null &&
    !review.sending &&
    review.question.trim().length > 0 &&
    review.question.length <= MAX_QUESTION_CHARS &&
    !review.blocked;
  return (
    <aside
      aria-label="Questions about selections"
      className="pointer-events-auto flex max-h-[min(70vh,560px)] w-[min(380px,calc(100vw-32px))] flex-col gap-3 overflow-auto rounded-[12px] border border-muted bg-elevation-level-2 p-4 shadow-convex"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="label-medium font-medium">Ask about selection</h2>
        <Button
          type="button"
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          onClick={onClose}
        >
          Close
        </Button>
      </div>
      <p className="label-2xs text-basic-muted">
        One answer from the chat’s model with no tools. It does not steer or interrupt the chat.
      </p>
      {review ? (
        <form
          aria-label="Review selection question"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (canAsk) onAsk();
          }}
        >
          <p className="label-2xs text-basic-muted">Selected from reply #{review.messageIndex}</p>
          <blockquote
            aria-label="Selected excerpt"
            className="max-h-[120px] overflow-auto border-l-2 border-muted pl-2 label-small whitespace-pre-wrap"
          >
            {review.excerpt}
          </blockquote>
          <TextArea
            id={`${id}-question`}
            aria-label="Your question"
            placeholder="What would you like to know about this excerpt?"
            textAreaSize={TextAreaSize.Small}
            value={review.question}
            maxLength={MAX_QUESTION_CHARS}
            disabled={review.sending}
            onChange={(event) => onQuestionChange(event.target.value)}
          />
          {review.error ? (
            <p role="alert" className="label-small text-basic-muted">
              {review.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              disabled={review.sending}
              onClick={onDiscard}
            >
              Discard
            </Button>
            <Button
              type="submit"
              size={ButtonSize.Small}
              disabled={!canAsk}
              loading={review.sending}
            >
              {review.uncertain ? "Retry question" : "Ask"}
            </Button>
          </div>
        </form>
      ) : null}
      {newestFirst.length > 0 ? (
        <section aria-label="Answers" className="flex flex-col gap-2">
          {newestFirst.map((question) => (
            <QuestionCard
              key={question.question_id}
              question={question}
              canceling={cancelingId === question.question_id}
              onCancel={onCancel}
            />
          ))}
        </section>
      ) : review ? null : (
        <p className="label-small text-basic-muted">
          Select text in a finished reply, then choose Ask about selection.
        </p>
      )}
    </aside>
  );
}
