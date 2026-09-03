import type React from "react";

import {
  Badge,
  BadgeColor,
  HoverHint,
  HoverHintSize,
  Popover,
  PopoverPlacement,
  PopoverSize,
  SessionTypeAvatar,
  TabButton,
  TabButtonSize,
  TooltipPosition,
} from "@/app/atoms";
import {
  CREATE_SESSION_BEHAVIORS,
  DEFAULT_SESSION_BEHAVIOR,
  sessionTypeFromBehavior,
} from "@/app/lib/sessionBehavior";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import type { SessionBehavior } from "@/app/types/api";

/**
 * Figma NewSessionPopover: Agent and Orchestrator. Agent is the default. The
 * shared Popover atom owns the 240px frame and shadow.
 */
export function NewSessionPopover({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (behavior: SessionBehavior) => void;
}) {
  return (
    <>
      {CREATE_SESSION_BEHAVIORS.map((option, index) => {
        const defaultChoice = option.id === DEFAULT_SESSION_BEHAVIOR;
        return (
          <TabButton
            key={option.id}
            type="button"
            size={TabButtonSize.Medium}
            disabled={disabled}
            aria-label={option.createLabel}
            className="!gap-2"
            onClick={() => onSelect(option.id)}
          >
            <SessionTypeAvatar sessionType={sessionTypeFromBehavior(option.id)} />
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="label-small min-w-0 truncate">{option.createLabel}</span>
              <span
                className="inline-flex shrink-0 [&_.icon]:!h-4 [&_.icon]:!w-4 [&_.icon]:!min-h-4 [&_.icon]:!min-w-4 [&_svg]:!h-4 [&_svg]:!w-4"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <HoverHint
                  title={option.label}
                  description={option.hint}
                  size={HoverHintSize.Small}
                  position={
                    index === CREATE_SESSION_BEHAVIORS.length - 1
                      ? TooltipPosition.BottomLeft
                      : TooltipPosition.TopLeft
                  }
                />
              </span>
            </span>
            {defaultChoice ? (
              <Badge
                text="Default"
                color={BadgeColor.Neutral}
                className="shrink-0 !px-1 !py-[2px] text-basic-tertiary"
              />
            ) : null}
          </TabButton>
        );
      })}
    </>
  );
}

/**
 * Anchors NewSessionPopover on a trigger. Choosing a row creates that chat
 * and closes the panel.
 */
export function NewSessionMenu({
  projectId,
  open,
  onOpenChange,
  onCreated,
  children,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  children: React.ReactNode;
}) {
  const { newChat } = useProjectActions();
  return (
    <Popover
      open={open}
      onClose={() => onOpenChange(false)}
      placement={PopoverPlacement.BottomLeft}
      size={PopoverSize.Small}
      sticky
      panelClassName="px-1 py-2 gap-2"
      content={
        <NewSessionPopover
          onSelect={(behavior) => {
            onOpenChange(false);
            onCreated?.();
            void newChat(projectId, false, behavior);
          }}
        />
      }
    >
      {children}
    </Popover>
  );
}
