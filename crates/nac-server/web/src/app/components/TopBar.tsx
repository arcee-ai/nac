import { useProductNavigationOwner } from "@/app/features/product-context/context";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { Link, useLocation } from "react-router-dom";

import { Logo } from "@/app/atoms";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { HeaderMenu } from "@/app/components/HeaderMenu";
import { McpServersButton } from "@/app/components/McpServersButton";
import { MobileHeader } from "@/app/components/MobileHeader";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { routes, sessionIdFromPath } from "@/app/lib/routes";

import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";

// Figma "HeaderSurface": the same ground-to-transparent gradient stacked twice,
// spanning the bar plus an overhang that fades the content scrolling below.
const GROUND_FADE =
  "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))";
const SURFACE_STYLE = { backgroundImage: `${GROUND_FADE}, ${GROUND_FADE}` };

export function TopBar() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileHeader />;
  return <WideTopBar />;
}

function WideTopBar() {
  const { useSidebarOffset } = useNativeRuntime().stores.sidebarLayoutStore;

  const navigation = useProductNavigationOwner();
  const isTablet = useIsTablet();
  const { pathname } = useLocation();
  const managed = useManagedHost();
  const sidebarOffset = useSidebarOffset();
  // A session or the project list already has the sidebar for navigation, so
  // the bar would only sit on top of that chrome.
  if (sessionIdFromPath(pathname) !== null || pathname === routes.list()) {
    return null;
  }

  return (
    <>
      <header
        className={cn(
          "fixed top-0 right-0 z-10 flex items-center justify-between py-2 shrink-0",
          "transition-[left] duration-300 ease-out",
          isTablet ? "h-[52px] px-3" : "h-[52px] px-4",
        )}
        style={{ left: sidebarOffset }}
      >
        <div
          className="absolute inset-x-0 top-0 -bottom-[8px] pointer-events-none"
          style={SURFACE_STYLE}
        />
        <div className={cn("relative flex items-center shrink-0", isTablet ? "gap-4" : "gap-8")}>
          {sidebarOffset > 0 ? null : (
            <Link to={routes.list()} className="shrink-0" aria-label="All projects">
              <Logo height={36} markOnly={isTablet} className="text-basic-primary" />
            </Link>
          )}
          <Breadcrumbs />
        </div>
        <div className="relative flex items-center shrink-0 gap-2">
          <McpServersButton onOpen={navigation.openMcp} />
          <HeaderMenu
            onConfigurations={navigation.openConfigurations}
            onSshConfigs={navigation.openSsh}
            onManagedHost={managed.isManaged ? managed.openSettings : undefined}
          />
        </div>
      </header>
    </>
  );
}
