import { useState } from "react";
import { Button, ButtonSize, ButtonVariant, KeyboardShortcut } from "@/app/atoms";
import { useAttentionKeys } from "@/app/features/attention/useAttentionKeys";
import { cn } from "@/app/lib/cn";
import type { QuestionRecord } from "@/app/types/api";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useAnswerTaskQuestion, useCancelTaskQuestion } from "./queries";
import { useQuestionAttention } from "./useQuestionAttention";

interface QuestionFormProps {
  sessionId: string;
  question: QuestionRecord;
  /** 1–9 pick a suggested answer while this is the card on top. */
  shortcuts?: boolean;
  /** Bare section rather than its own bordered card, for a host that frames it. */
  bare?: boolean;
  /** 44px controls for a touch screen. */
  touch?: boolean;
}

/** One pending question: its suggested answers, a free-text answer, and Cancel. */
export function QuestionForm({
  sessionId,
  question,
  shortcuts = false,
  bare = false,
  touch = false,
}: QuestionFormProps) {
  const [answer, setAnswer] = useState("");
  const reply = useAnswerTaskQuestion();
  const cancel = useCancelTaskQuestion();
  const request = question.request;
  const submitting = reply.isPending || cancel.isPending;
  const choices = request.choices;

  // A digit only picks the suggestion into the field; sending stays explicit.
  useAttentionKeys(shortcuts && choices.length > 0 && !submitting, (key) => {
    if (!/^[1-9]$/u.test(key)) return false;
    const choice = choices[Number(key) - 1];
    if (choice === undefined) return false;
    setAnswer(choice);
    return true;
  });

  return (
    <section
      aria-label="Task question"
      className={cn(
        "flex max-h-[50dvh] min-w-0 flex-col gap-3 overflow-y-auto",
        !bare && "rounded-card border border-tertiary bg-elevation-level-1 p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-subheading text-basic-primary">
            {request.responder_class === "human_decision"
              ? "Your decision is needed"
              : "Information is needed"}
          </p>
          <p className="type-body-chrome mt-1 whitespace-pre-wrap break-words text-basic-primary">
            {request.text}
          </p>
        </div>
        <Button
          size={touch ? ButtonSize.Large : ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          className="shrink-0"
          disabled={submitting}
          onClick={() =>
            cancel.mutate({ sessionId, requestId: request.request_id, revision: question.revision })
          }
        >
          Cancel question
        </Button>
      </div>
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested answers">
          {choices.map((choice, index) => (
            <Button
              key={choice}
              className={cn(
                "!h-auto max-w-full !whitespace-normal break-words text-left",
                touch ? "min-h-11 py-2.5" : "min-h-8 py-1.5",
              )}
              size={ButtonSize.Small}
              variant={
                answer === choice ? ButtonVariant.SecondaryHighlighted : ButtonVariant.Secondary
              }
              aria-pressed={answer === choice}
              disabled={submitting}
              onClick={() => setAnswer(choice)}
            >
              {shortcuts && index < 9 ? (
                <span aria-hidden className="mr-1.5 inline-flex">
                  <KeyboardShortcut keys={[String(index + 1)]} spelled />
                </span>
              ) : null}
              {choice}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label className="type-meta block text-basic-secondary">
          Your answer
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={4000}
            disabled={submitting}
            rows={2}
            className="type-body-chrome mt-1 w-full resize-y rounded-lg border border-tertiary bg-elevation-level-1 px-3 py-2 text-basic-primary outline-none placeholder:text-basic-muted focus:border-secondary [@media(pointer:coarse)]:text-[16px]"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="type-meta min-w-0 flex-1 text-basic-tertiary">
            This answers this question only. Other chat messages leave it open.
          </p>
          <Button
            type="button"
            onClick={() => {
              if (!answer.trim() || submitting) return;
              reply.mutate({
                sessionId,
                answer: {
                  request_id: request.request_id,
                  run_id: request.run_id,
                  generation: request.generation,
                  expected_revision: question.revision,
                  answer,
                },
              });
            }}
            variant={ButtonVariant.Primary}
            size={touch ? ButtonSize.Large : ButtonSize.Medium}
            disabled={!answer.trim() || submitting}
          >
            Send answer
          </Button>
        </div>
      </div>
      {(reply.error || cancel.error) && (
        <p role="alert" className="type-meta text-error-primary">
          {errorMessage(reply.error ?? cancel.error)}
        </p>
      )}
    </section>
  );
}

/** Every pending question at once, for a view without the attention card. */
export function QuestionControls({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const { questions, notice } = useQuestionAttention(sessionId, enabled);
  if (!enabled) return null;
  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-[720px] flex-col gap-2">
      {notice ? (
        <p
          role={notice.tone}
          className={cn(
            "type-body-chrome rounded-card border border-tertiary p-3",
            notice.tone === "alert" ? "text-error-primary" : "text-basic-secondary",
          )}
        >
          {notice.text}
        </p>
      ) : null}
      {questions.map((question) => (
        <QuestionForm
          key={`${sessionId}:${question.request.request_id}:${question.revision}`}
          sessionId={sessionId}
          question={question}
        />
      ))}
    </div>
  );
}
