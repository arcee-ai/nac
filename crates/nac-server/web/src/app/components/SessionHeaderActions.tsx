import { useState } from "react";
import { useLocation } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  Separator,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { isActiveRun } from "@/app/lib/format";
import { sessionIdFromPath } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useSessions } from "@/app/services/queries";
import { toggleSidePanelExpanded } from "@/app/store/sessionLayoutStore";

/**
 * Phone-only session controls in the top bar. The design allows a single
 * button here, so everything a card would offer on the list — plus the side
 * box, which has no half of the screen to live in at this width and opens as a
 * dialog instead — sits behind one overflow menu.
 */
export function SessionHeaderActions() {
  const { pathname } = useLocation();
  const sessionId = sessionIdFromPath(pathname);
  const isMobile = useIsMobile();
  const actions = useSessionActions();
  const { data: sessions = [] } = useSessions();
  const [open, setOpen] = useState(false);

  if (!isMobile || !sessionId) return null;

  const entry = sessions.find((item) => item.summary.session_id === sessionId);
  const summary = entry?.summary ?? null;
  const running = isActiveRun(entry?.active_run);

  const act = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.BottomLeft}
      size="w-[240px]"
      sheetClassName="px-2"
      content={
        <>
          <TabButton
            size={TabButtonSize.Large}
            onClick={act(toggleSidePanelExpanded)}
          >
            <Icon iconName={IconName.OpenSidebar} />
            <span className="text-left flex-grow">Open panel</span>
          </TabButton>
          <TabButton
            size={TabButtonSize.Large}
            onClick={act(() => actions.settings(sessionId))}
          >
            <Icon iconName={IconName.Gear} />
            <span className="text-left flex-grow">Session settings</span>
          </TabButton>
          {summary ? (
            <>
              <TabButton
                size={TabButtonSize.Large}
                onClick={act(() => actions.rename(summary))}
              >
                <Icon iconName={IconName.Edit} />
                <span className="text-left flex-grow">Rename</span>
              </TabButton>
              <TabButton
                size={TabButtonSize.Large}
                onClick={act(() => void actions.togglePin(summary))}
              >
                <Icon
                  iconName={summary.pinned ? IconName.Unpin : IconName.Pin}
                />
                <span className="text-left flex-grow">
                  {summary.pinned ? "Unpin" : "Pin"}
                </span>
              </TabButton>
              <Separator />
              {running ? (
                <TabButton
                  size={TabButtonSize.Large}
                  variant={TabButtonVariant.Destructive}
                  onClick={act(() => void actions.stopRun(summary))}
                >
                  <Icon iconName={IconName.Stop} />
                  <span className="text-left flex-grow">Stop run</span>
                </TabButton>
              ) : (
                <TabButton
                  size={TabButtonSize.Large}
                  variant={TabButtonVariant.Destructive}
                  onClick={act(() => actions.remove(summary))}
                >
                  <Icon iconName={IconName.Trash} />
                  <span className="text-left flex-grow">Delete</span>
                </TabButton>
              )}
            </>
          ) : null}
        </>
      }
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Icon}
        className="btn-round"
        aria-label="Session actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon iconName={IconName.MenuVertical} />
      </Button>
    </Popover>
  );
}
