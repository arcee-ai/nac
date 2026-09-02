import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { SESSION_PANELS, type SessionPanel } from "@/app/lib/routes";

const TAB = {
  threads: { label: "Actions", iconName: IconName.Flow },
  actions: { label: "Actions", iconName: IconName.Brain },
  delegated: { label: "Delegated", iconName: IconName.People },
  files: { label: "Files", iconName: IconName.Folders },
  worksets: { label: "Worksets", iconName: IconName.Checklist },
  history: { label: "History", iconName: IconName.History },
} satisfies Record<SessionPanel, { label: string; iconName: IconName }>;

/**
 * The phone's panel switcher: a floating pill pinned to the bottom of the
 * modal box, standing in for the tab row a wide box fits in its header.
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
    <div className="absolute inset-x-0 bottom-0 z-10 px-2 py-4 pointer-events-none">
      <div
        className="flex items-center gap-1 w-full p-[2px] rounded-[18px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto"
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
                "flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]",
                active ? "btn-primary" : "btn-ghost",
              )}
              onClick={() => onPanelChange(name)}
            >
              <Icon iconName={TAB[name].iconName} size={28} />
              <span
                className={cn(
                  "label-micro font-bold truncate max-w-full",
                  active ? null : "text-basic-primary",
                )}
              >
                {TAB[name].label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
