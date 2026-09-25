import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  Icon,
  IconName,
  KeyboardShortcut,
  Popover,
  PopoverPlacement,
  PopoverSize,
  TabButton,
} from "@/app/atoms";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import { NEW_CHAT_KEYS } from "@/app/lib/shortcuts";
import { useToast } from "@/app/providers/ToastProvider";
import { useCreateSession } from "@/app/services/queries";
import type { SessionBehavior } from "@/app/types/api";

const OPTIONS: readonly {
  behavior: SessionBehavior;
  label: string;
  icon: IconName;
  shortcut?: readonly string[];
}[] = [
  {
    behavior: "direct",
    label: "Agent Session",
    icon: IconName.Plane,
    shortcut: NEW_CHAT_KEYS,
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
  const createSession = useCreateSession();

  const openMenu = () => {
    if (!projectId) {
      onUnavailable();
      return;
    }
    setOpen((current) => !current);
  };

  const start = async (behavior: SessionBehavior) => {
    if (!projectId || createSession.isPending) return;
    try {
      const snapshot = await createSession.mutateAsync({ project_id: projectId, behavior });
      const sessionId = snapshot.metadata.session_id;
      setOpen(false);
      if (sessionId) navigate(routes.session(sessionId));
    } catch (error) {
      toast.error(`Failed to start a chat: ${humanErrorText(toRunError(error))}`);
    }
  };

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
                disabled={createSession.isPending}
                hoverHint={{
                  title: presentation.label,
                  description: behaviorDescription(option.behavior),
                  muted: true,
                }}
                trailing={
                  option.shortcut ? <KeyboardShortcut keys={[...option.shortcut]} /> : undefined
                }
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
