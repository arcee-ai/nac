import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import type { QuestionRecord } from "@/app/types/api";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useAnswerTaskQuestion, useCancelTaskQuestion, useTaskQuestions } from "./queries";

function QuestionForm({ sessionId, question }: { sessionId: string; question: QuestionRecord }) {
  const [answer, setAnswer] = useState("");
  const reply = useAnswerTaskQuestion();
  const cancel = useCancelTaskQuestion();
  const request = question.request;
  const submitting = reply.isPending || cancel.isPending;
  return (
    <section
      aria-label="Task question"
      className="max-h-[50dvh] space-y-3 overflow-y-auto rounded-lg border border-muted bg-elevation-level-1 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-basic-primary">
            {request.responder_class === "human_decision"
              ? "Your decision is needed"
              : "Information is needed"}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-basic-primary">
            {request.text}
          </p>
        </div>
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          disabled={submitting}
          onClick={() =>
            cancel.mutate({ sessionId, requestId: request.request_id, revision: question.revision })
          }
        >
          Cancel question
        </Button>
      </div>
      {request.choices.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested answers">
          {request.choices.map((choice) => (
            <Button
              key={choice}
              className="max-w-full !h-auto !whitespace-normal break-words py-2 text-left"
              size={ButtonSize.Small}
              variant={ButtonVariant.Secondary}
              disabled={submitting}
              onClick={() => setAnswer(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        <label className="block text-sm text-basic-secondary">
          Your answer
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={4000}
            disabled={submitting}
            rows={2}
            className="mt-1 w-full resize-y rounded border border-muted bg-transparent px-3 py-2 text-basic-primary"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-basic-tertiary">
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
            size={ButtonSize.Small}
            disabled={!answer.trim() || submitting}
          >
            Send answer
          </Button>
        </div>
      </div>
      {(reply.error || cancel.error) && (
        <p role="alert" className="text-sm text-error-primary">
          {errorMessage(reply.error ?? cancel.error)}
        </p>
      )}
    </section>
  );
}

export function QuestionControls({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const [params] = useSearchParams();
  const selected = params.get("question_request");
  const questions = useTaskQuestions(sessionId, enabled);
  if (!enabled) return null;
  const pending = questions.data?.filter((question) => question.status === "pending") ?? [];
  const exact = selected
    ? pending.find((question) => question.request.request_id === selected)
    : undefined;
  return (
    <div className="pointer-events-auto mx-auto w-full max-w-[656px] space-y-2 px-2">
      {selected && questions.isLoading && (
        <p role="status" className="text-sm text-basic-secondary">
          Loading the exact task question…
        </p>
      )}
      {selected && questions.isError && (
        <p role="alert" className="text-sm text-error-primary">
          {errorMessage(questions.error)}
        </p>
      )}
      {selected && questions.isSuccess && !exact && (
        <p role="status" className="rounded border border-muted p-3 text-sm text-basic-secondary">
          This task question is no longer pending. A previous answer cannot answer a replacement
          question.
        </p>
      )}
      {(selected && exact ? [exact] : selected ? [] : pending).map((question) => (
        <QuestionForm
          key={`${sessionId}:${question.request.request_id}:${question.revision}`}
          sessionId={sessionId}
          question={question}
        />
      ))}
    </div>
  );
}
