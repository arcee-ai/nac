import { useCallback, useLayoutEffect, useState } from "react";

import { useIsDesktop, useIsMobile } from "@/app/hooks/useMediaQuery";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { cn } from "@/app/lib/cn";
import { MOD } from "@/app/lib/shortcuts";
import { setSidebarOffset } from "@/app/store/sidebarLayoutStore";

import { LeftSidebarPanel } from "./LeftSidebarPanel";
import { LeftSidebarRail } from "./LeftSidebarRail";
import { useSidebarCommands } from "./useSidebarCommands.tsx";

/** Collapsed icon column, matching the Figma rail. */
export const SIDEBAR_RAIL_WIDTH = 52;
/** Expanded panel, matching the Figma sidebar. */
export const SIDEBAR_PANEL_WIDTH = 320;

const STORAGE_KEY = "nac.sidebar.open";
const TOGGLE_KEYS = [MOD, "h"];

function storedOpen(): boolean | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    // A private-mode store that throws is the same as no preference.
  }
  return null;
}

/**
 * Collapsible session navigation, in the ArceeFM arrangement: a 52px rail stays
 * put, and the 320px panel slides over it. The rail's width is what the rest of
 * the row lays out against, so opening the panel pushes the chat aside.
 */
export function LeftSidebar({ variant = "session" }: { variant?: "session" | "projects" }) {
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  // A phone-sized first paint must not freeze a closed value into storage or
  // into later desktop layout. Until the user toggles, follow the stored
  // preference or the xl default.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? storedOpen() ?? isDesktop;
  const toggle = useCallback(() => {
    setUserOpen((current) => {
      const next = !(current ?? storedOpen() ?? isDesktop);
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preference is convenience; the sidebar still works without it.
      }
      return next;
    });
  }, [isDesktop]);
  const commands = useSidebarCommands();

  useLayoutEffect(() => {
    setSidebarOffset(isMobile ? 0 : isOpen ? SIDEBAR_PANEL_WIDTH : SIDEBAR_RAIL_WIDTH);
  }, [isMobile, isOpen]);

  useLayoutEffect(() => {
    return () => setSidebarOffset(0);
  }, []);

  useKeyboardShortcuts([{ keys: TOGGLE_KEYS, onTrigger: toggle, enabled: !isMobile }]);

  // A phone has no room for the rail: the chat takes the screen.
  if (isMobile) return null;

  return (
    <div
      data-sidebar="true"
      className={cn(
        "relative h-full shrink-0 transition-[width] duration-500 ease-in-out",
        isOpen ? "w-[320px]" : "w-[52px]",
      )}
    >
      {isOpen ? null : (
        <div className="absolute inset-y-0 left-0 w-[52px]">
          <LeftSidebarRail
            commands={commands}
            onToggle={toggle}
            toggleKeys={TOGGLE_KEYS}
            variant={variant}
          />
        </div>
      )}
      <div
        className={cn(
          "absolute inset-y-0 z-[1] h-full w-[320px] transition-[left] duration-500 ease-in-out",
          isOpen ? "left-0" : "left-[-320px]",
        )}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <LeftSidebarPanel
          isOpen={isOpen}
          commands={commands}
          onToggle={toggle}
          toggleKeys={TOGGLE_KEYS}
          variant={variant}
        />
      </div>
      {commands.modals}
    </div>
  );
}
