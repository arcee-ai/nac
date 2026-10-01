import { useState, type ReactNode } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, Popover, PopoverPlacement, PopoverSize, TabButton } from "@/app/atoms";
import { ClientRequestError } from "@/app/effect/errors";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import {
  sessionBehaviorPresentation,
  sessionBehaviourChoiceEnabled,
} from "@/app/lib/sessionBehavior";
import { useToast } from "@/app/providers/ToastProvider";
import { createSessionAtom } from "@/app/services/queries";
import type { SessionBehavior } from "@/app/types/api";

function commandError(cause: unknown): unknown {
  return cause instanceof ClientRequestError ? cause.error : cause;
}

const OPTIONS: readonly {
  behavior: SessionBehavior;
  label: string;
  icon: IconName;
}[] = [
  {
    behavior: "direct",
    label: "Agent Session",
    icon: IconName.Plane,
  },
  {
    behavior: "direct-with-orchestrator",
    label: "Agent + Orchestrator Session",
    icon: IconName.PlaneAdd,
  },
  {
    behavior: "orchestrator",
    label: "Orchestrator Session",
    icon: IconName.Orchestrator,
  },
];

function behaviorDescription(behavior: SessionBehavior): string {
  const option = sessionBehaviorPresentation(behavior);
  return [option.topLevel, option.editing, option.delegation, option.inspection].join(" ");
}

/**
 * Picks a session behavior and starts it in the open project. With no project
 * on screen, the trigger falls through to creating one.
 */
export function NewSessionPopover({
  projectId,
  onUnavailable,
  className,
  children,
}: {
  projectId: string | null;
  onUnavailable: () => void;
  className?: string;
  children: (openMenu: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const createSession = useAtomSet(createSessionAtom, { mode: "promise" });
  const creatingSession = useAtomValue(createSessionAtom).waiting;

  const choiceEnabled = sessionBehaviourChoiceEnabled();

  const start = async (behavior: SessionBehavior) => {
    if (!projectId || creatingSession) return;
    try {
      const snapshot = await createSession({ project_id: projectId, behavior });
      const sessionId = snapshot.metadata.session_id;
      setOpen(false);
      if (sessionId) navigate(routes.session(sessionId));
    } catch (error) {
      toast.error(`Failed to start a chat: ${humanErrorText(toRunError(commandError(error)))}`);
    }
  };

  const openMenu = () => {
    if (!projectId) {
      onUnavailable();
      return;
    }
    if (!choiceEnabled) {
      void start("direct");
      return;
    }
    setOpen((current) => !current);
  };

  if (!choiceEnabled) {
    return <div className={className}>{children(openMenu)}</div>;
  }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      placement={PopoverPlacement.RightTop}
      size={PopoverSize.Medium}
      panelClassName="gap-2"
      className={className}
      content={
        <>
          {OPTIONS.map((option) => {
            const presentation = sessionBehaviorPresentation(option.behavior);
            return (
              <TabButton
                key={option.behavior}
                disabled={creatingSession}
                hoverHint={{
                  title: presentation.label,
                  description: behaviorDescription(option.behavior),
                  muted: true,
                }}
                onClick={() => void start(option.behavior)}
              >
                <Icon iconName={option.icon} />
                <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
              </TabButton>
            );
          })}
        </>
      }
    >
      {children(openMenu)}
    </Popover>
  );
}
