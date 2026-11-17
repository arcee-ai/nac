import { Icon, IconName } from "@/app/atoms";
import { useInbox } from "@/app/features/inbox/inboxContext";
import { useSidebar } from "@/app/features/sidebar/useSidebar";
import { cn } from "@/app/lib/cn";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

/**
 * Home's one line about the Inbox: "2 need you →", only when something does.
 * It opens the Inbox — in the sidebar, or in the list below on a phone.
 */
export function NeedsYouLine({ onShowList }: { onShowList?: () => void }) {
  const { model } = useInbox();
  const { setView } = useNativeRuntime().stores.sidebarLayoutStore;
  const sidebar = useSidebar();
  const count = model.badge;
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setView("inbox");
        if (onShowList) onShowList();
        else sidebar.setOpen(true);
      }}
      className={cn(
        "type-label inline-flex min-h-8 items-center gap-2 self-center rounded-pill px-3 outline-none max-md:min-h-11",
        "text-[var(--f-amber-text)] hover:bg-[var(--f-amber-wash)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
      )}
    >
      <span aria-hidden className="size-1.5 rounded-pill bg-[var(--f-amber)]" />
      {count} {count === 1 ? "needs" : "need"} you
      <Icon iconName={IconName.ArrowRight} size={14} />
    </button>
  );
}
