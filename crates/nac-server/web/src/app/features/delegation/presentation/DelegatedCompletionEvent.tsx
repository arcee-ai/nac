import { useNavigate } from "react-router-dom";

import { Button, ButtonSize, ButtonVariant, CopyButton, TooltipPosition } from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import type { DelegatedCompletion } from "@/app/features/delegation/completion";
import { Markdown } from "@/app/lib/markdown";
import { routes } from "@/app/lib/routes";
import type { DelegatedCompletionTurn } from "@/app/lib/transcript";

function typeLabel(kind: DelegatedCompletion["kind"]): string {
  return kind === "coding-agent" ? "Coding agent" : "Orchestrator";
}

function completionMarkdown(completion: DelegatedCompletion): string {
  const parts = [
    `**${typeLabel(completion.kind)} ${completion.status}:** ${completion.description}`,
    `Generation ${completion.generation}`,
  ];
  if (completion.outcome) parts.push(completion.outcome);
  if (completion.changes) parts.push(`**Changes:** ${completion.changes}`);
  if (completion.verification) {
    parts.push(`**Verification:** ${completion.verification}`);
  }
  return parts.join("\n\n");
}

export function DelegatedCompletionEvent({ turn }: { turn: DelegatedCompletionTurn }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const markdown = completionMarkdown(turn.completion);
  const type = typeLabel(turn.completion.kind);
  return (
    <div
      role="status"
      aria-label={`${type} ${turn.completion.status}`}
      className="flex flex-col items-end w-full max-w-full pt-4 pb-8"
    >
      <div className="py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex max-w-full">
        <Markdown>{markdown}</Markdown>
      </div>
      <div className="flex items-center justify-end gap-3 pt-3">
        <CopyButton
          value={markdown}
          size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
          variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
          title="Copy message"
          position={TooltipPosition.BottomLeft}
          className="md:!h-4 md:!min-h-4 md:!p-0"
        />
        <Button
          size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
          variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
          onClick={() => navigate(routes.session(turn.completion.sessionId))}
        >
          Open exact conspect
        </Button>
      </div>
    </div>
  );
}
