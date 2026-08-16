import { useLocation } from "react-router-dom";

import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { sessionIdFromPath } from "@/app/lib/routes";
import { toggleSidePanelExpanded } from "@/app/store/sessionLayoutStore";

/**
 * Phone-only session control in the top bar. The side box has no half of the
 * screen to live in at this width, so the button brings it up as a dialog; the
 * session's own actions are reached from the composer and the list.
 */
export function SessionHeaderActions() {
  const { pathname } = useLocation();
  const sessionId = sessionIdFromPath(pathname);
  const isMobile = useIsMobile();

  if (!isMobile || !sessionId) return null;

  return (
    <Button
      variant={ButtonVariant.Ghost}
      size={ButtonSize.Medium}
      content={ButtonContent.Icon}
      className="btn-round"
      aria-label="Open panel"
      onClick={toggleSidePanelExpanded}
    >
      <Icon iconName={IconName.OpenMobileModal} />
    </Button>
  );
}
