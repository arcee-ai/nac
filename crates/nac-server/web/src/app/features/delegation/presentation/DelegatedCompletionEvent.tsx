import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  ChatSessionMessage,
  ChatSessionMessageVariant,
} from "@/app/atoms";
import { routes } from "@/app/lib/routes";
import type { DelegatedCompletionTurn } from "@/app/lib/transcript";

export function DelegatedCompletionEvent({ turn }: { turn: DelegatedCompletionTurn }) {
  const navigate = useNavigate();
  const type = turn.completion.kind === "coding-agent" ? "Coding agent" : "Orchestrator";
  const variant =
    turn.completion.status === "completed"
      ? ChatSessionMessageVariant.Success
      : turn.completion.status === "failed"
        ? ChatSessionMessageVariant.Error
        : ChatSessionMessageVariant.Danger;
  return (
    <ChatSessionMessage
      role="status"
      aria-label={`${type} ${turn.completion.status}`}
      className="my-5"
      variant={variant}
      title={`${type} ${turn.completion.status}: ${turn.completion.description}`}
    >
      <span className="flex flex-col gap-2">
        <span>Generation {turn.completion.generation}</span>
        {turn.completion.outcome ? (
          <span className="whitespace-pre-wrap">{turn.completion.outcome}</span>
        ) : null}
        {turn.completion.changes ? (
          <span className="whitespace-pre-wrap">Changes: {turn.completion.changes}</span>
        ) : null}
        {turn.completion.verification ? (
          <span className="whitespace-pre-wrap">Verification: {turn.completion.verification}</span>
        ) : null}
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          onClick={() => navigate(routes.session(turn.completion.sessionId))}
        >
          Open exact transcript
        </Button>
      </span>
    </ChatSessionMessage>
  );
}
