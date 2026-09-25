import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  TabButton,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { useManagedOrchestrators, useTraditionalChildren } from "@/app/services/queries";
import type { SessionBehavior } from "@/app/types/api";

const SUBAGENT_HINT = {
  title: "Create Subagent",
  description:
    "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Subagents.",
  muted: true,
};

const ORCHESTRATOR_HINT = {
  title: "Create Orchestrator Subagent",
  description:
    "Start a separate NAC planning session. Browse, steer, continue, and cancel it from Subagents.",
  muted: true,
};

interface AgentSpawnButtonProps {
  sessionId: string;
  behavior: SessionBehavior | null;
  className?: string;
  onCreateSubagent: () => void;
  onCreateOrchestrator: () => void;
}

/** "+" beside a direct agent's message field. Opens the spawn actions. */
export function AgentSpawnButton({
  sessionId,
  behavior,
  className,
  onCreateSubagent,
  onCreateOrchestrator,
}: AgentSpawnButtonProps) {
  const orchestrator = behavior === "direct-with-orchestrator";
  const children = useTraditionalChildren(sessionId, true);
  const orchestrators = useManagedOrchestrators(sessionId, orchestrator);
  const [open, setOpen] = useState(false);
  const running =
    (children.data ?? []).some((child) => child.status === "running") ||
    (orchestrators.data ?? []).some((item) => item.status === "running");

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      sheetOnMobile={false}
      placement={PopoverPlacement.TopRight}
      panelClassName="gap-2"
      className={className}
      content={
        <>
          <TabButton
            hoverHint={SUBAGENT_HINT}
            onClick={() => {
              setOpen(false);
              onCreateSubagent();
            }}
          >
            <Icon iconName={IconName.Plane} />
            <span className="min-w-0 flex-1 truncate text-left">Create Subagent</span>
          </TabButton>
          {orchestrator ? (
            <TabButton
              hoverHint={ORCHESTRATOR_HINT}
              onClick={() => {
                setOpen(false);
                onCreateOrchestrator();
              }}
            >
              <Icon iconName={IconName.Orchestrator} />
              <span className="min-w-0 flex-1 truncate text-left">
                Create Orchestrator Subagent
              </span>
            </TabButton>
          ) : null}
        </>
      }
    >
      <Button
        type="button"
        size={ButtonSize.Large}
        variant={running ? ButtonVariant.GhostHighlightedAccent : ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Spawn"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon
          iconName={IconName.Add}
          size={24}
          className={cn("transition-transform", open && "rotate-45")}
        />
      </Button>
    </Popover>
  );
}
