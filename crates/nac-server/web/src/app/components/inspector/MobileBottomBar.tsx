import { Icon } from "@/app/atoms";
import { PANEL_ICON } from "@/app/components/inspector/sessionPanelIcons";
import { cn } from "@/app/lib/cn";
import { SESSION_PANEL_LABEL, SESSION_PANELS, type SessionPanel } from "@/app/lib/routes";

/**
 * The phone's panel switcher: a floating bar pinned to the bottom of a list
 * screen in the side box dialog, standing in for the tab row a wide box fits
 * in its header.
 */
export function MobileBottomBar({
  panel,
  onPanelChange,
  panels = SESSION_PANELS,
}: {
  panel: SessionPanel;
  onPanelChange: (panel: SessionPanel) => void;
  panels?: readonly SessionPanel[];
}) {
  return (
    <div className="fade-from-bottom absolute inset-x-0 bottom-0 z-10 p-3 pointer-events-none">
      <div
        className="flex items-center gap-[2px] w-full rounded-[12px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto"
        role="tablist"
      >
        {panels.map((name) => {
          const active = panel === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "flex flex-col flex-1 min-w-0 items-center justify-center gap-[6px] h-16 rounded-[12px]",
                "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2",
                active ? "btn-primary" : "btn-ghost",
              )}
              onClick={() => onPanelChange(name)}
            >
              <Icon iconName={PANEL_ICON[name]} size={20} />
              <span
                className={cn(
                  "text-[11px] leading-[14px] font-medium truncate max-w-full",
                  active ? null : "text-basic-primary",
                )}
              >
                {SESSION_PANEL_LABEL[name]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
