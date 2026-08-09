import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Logo,
} from "@/app/atoms";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { HeaderMenu } from "@/app/components/HeaderMenu";
import { SessionHeaderActions } from "@/app/components/SessionHeaderActions";
import { ConfigurationsModal } from "@/app/components/modals/ConfigurationsModal";
import { SshConfigsModal } from "@/app/components/modals/SshConfigsModal";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";

// Figma "HeaderSurface": the same ground-to-transparent gradient stacked twice,
// spanning the bar plus an overhang that fades the content scrolling below.
const GROUND_FADE =
  "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))";
const SURFACE_STYLE = { backgroundImage: `${GROUND_FADE}, ${GROUND_FADE}` };

export function TopBar() {
  const [configuring, setConfiguring] = useState(false);
  const [sshConfigs, setSshConfigs] = useState(false);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const { pathname } = useLocation();
  const actions = useSessionActions();
  const inSession = sessionIdFromPath(pathname) !== null;

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-10 flex items-center justify-between py-2 shrink-0",
          isMobile ? "h-16 px-3" : isTablet ? "h-[52px] px-3" : "h-[52px] px-4",
        )}
      >
        <div
          className={cn(
            "absolute inset-x-0 top-0 pointer-events-none",
            // On a phone the fade also has to cover the search bar sitting
            // directly under the bar.
            isMobile ? "-bottom-[76px]" : "-bottom-[28px]",
          )}
          style={SURFACE_STYLE}
        />
        <div
          className={cn(
            "relative flex items-center",
            isMobile
              ? "flex-1 min-w-0 gap-6"
              : isTablet
                ? "shrink-0 gap-4"
                : "shrink-0 gap-8",
          )}
        >
          <Link
            to={routes.list()}
            className="shrink-0"
            aria-label="All sessions"
          >
            <Logo
              height={isMobile ? 32 : isTablet ? 36 : 28}
              markOnly={isMobile || isTablet}
              className="text-basic-primary"
            />
          </Link>
          <Breadcrumbs />
        </div>
        <div
          className={cn(
            "relative flex items-center shrink-0",
            isMobile && "gap-3",
          )}
        >
          {/* On the list a phone has no filter rail to launch from, so the
              primary action rides in the bar. */}
          {isMobile && !inSession ? (
            <Button
              variant={ButtonVariant.Primary}
              size={ButtonSize.Medium}
              content={ButtonContent.Icon}
              className="btn-round"
              aria-label="New session"
              onClick={actions.launch}
            >
              <Icon iconName={IconName.Add} />
            </Button>
          ) : null}
          <SessionHeaderActions />
          <HeaderMenu
            onConfigurations={() => setConfiguring(true)}
            onSshConfigs={() => setSshConfigs(true)}
          />
        </div>
      </header>
      <ConfigurationsModal
        open={configuring}
        onClose={() => setConfiguring(false)}
      />
      <SshConfigsModal open={sshConfigs} onClose={() => setSshConfigs(false)} />
    </>
  );
}
