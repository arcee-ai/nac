import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import type { SessionSummarySnapshot } from "@/app/types/api";

/**
 * Pin and rename for a subagent's row. There is no delete: the server deletes
 * primary sessions only.
 */
export function SubagentRowActions({
  summary,
  title,
  isMobile,
}: {
  summary: SessionSummarySnapshot;
  title: string;
  isMobile: boolean;
}) {
  const { rename, togglePin } = useSessionActions();
  return (
    <ChatSessionActions
      title={title}
      pinned={summary.pinned}
      isMobile={isMobile}
      onPin={() => void togglePin(summary)}
      onRename={() => rename(summary)}
    />
  );
}
