import {
  ButtonSize,
  ButtonVariant,
  HorizontalTabsItem,
  HorizontalTabsItemSize,
  Select,
} from "@/app/atoms";

/** Which half of a thread the detail pane is showing. */
export type ThreadDetailView = "log" | "overview";

const VIEW_LABEL = {
  log: "Logs",
  overview: "Overview",
} satisfies Record<ThreadDetailView, string>;

const THREAD_DETAIL_VIEWS: ThreadDetailView[] = ["log", "overview"];

const VIEW_ITEMS = THREAD_DETAIL_VIEWS.map((name) => ({ id: name, label: VIEW_LABEL[name] }));

/**
 * Logs / Overview tabs for the desktop detail header. They are toggle buttons
 * rather than tabs, so the set is a named group.
 */
export function ViewSwitcher({
  view,
  onChange,
}: {
  view: ThreadDetailView;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <div className="flex items-center gap-2 shrink-0" role="group" aria-label="Thread detail view">
      {THREAD_DETAIL_VIEWS.map((name) => (
        <HorizontalTabsItem
          key={name}
          size={HorizontalTabsItemSize.Small}
          active={view === name}
          className="!h-8"
          aria-pressed={view === name}
          onClick={() => onChange(name)}
        >
          {VIEW_LABEL[name]}
        </HorizontalTabsItem>
      ))}
    </div>
  );
}

/**
 * The same switch as a select: trailing the panel's header row on a tablet,
 * and floating over the foot of the view on a phone.
 */
export function ThreadViewSelect({
  view,
  onChange,
  floating = false,
}: {
  view: ThreadDetailView;
  onChange: (view: ThreadDetailView) => void;
  floating?: boolean;
}) {
  return (
    <Select
      size={floating ? ButtonSize.Large : ButtonSize.Small}
      variant={floating ? ButtonVariant.Primary : ButtonVariant.Secondary}
      floating={floating}
      value={view}
      items={VIEW_ITEMS}
      onValueChange={(id) =>
        // SAFETY: the ids are built from THREAD_DETAIL_VIEWS above, so every
        // value the picker can emit is a ThreadDetailView.
        onChange(id as ThreadDetailView)
      }
    />
  );
}
