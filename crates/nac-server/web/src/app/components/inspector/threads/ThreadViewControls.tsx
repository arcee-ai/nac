import { Button, ButtonSize, ButtonVariant, Select } from "@/app/atoms";
import { TaskPill } from "@/app/components/inspector/TaskPreview";

/** Which half of a thread the detail pane is showing. */
export type ThreadDetailView = "log" | "overview";

const VIEW_LABEL = {
  log: "Command Log",
  overview: "Episodes",
} satisfies Record<ThreadDetailView, string>;

const THREAD_DETAIL_VIEWS: ThreadDetailView[] = ["log", "overview"];

/**
 * Phone form of the switch: pills floating over the view they change, since the
 * box header at that width is already full. The phone's dialog title has no
 * room for the task the wider headers carry beside the thread name, so it rides
 * along here as a third pill — one that opens a sheet instead of swapping the
 * view, and so takes only the width of its own word rather than an equal share.
 */
export function ViewPills({
  view,
  action,
  canSteer,
  onSteer,
  onChange,
}: {
  view: ThreadDetailView;
  /** What the open thread was asked to do, if the dispatch is known. */
  action: string;
  canSteer: boolean;
  onSteer: () => void;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <div
      className="absolute inset-x-0 top-0 flex items-center gap-2 overflow-x-auto overscroll-x-contain p-2"
      role="toolbar"
      aria-label="Thread controls"
    >
      {THREAD_DETAIL_VIEWS.map((name) => (
        <div
          key={name}
          className="flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden"
        >
          <Button
            className="w-full"
            size={ButtonSize.Medium}
            variant={view === name ? ButtonVariant.Primary : ButtonVariant.Secondary}
            aria-pressed={view === name}
            onClick={() => onChange(name)}
          >
            {VIEW_LABEL[name]}
          </Button>
        </div>
      ))}
      {action ? (
        <div className="flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden">
          <TaskPill action={action} />
        </div>
      ) : null}
      {canSteer ? (
        <div className="flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden">
          <Button size={ButtonSize.Medium} variant={ButtonVariant.Secondary} onClick={onSteer}>
            Steer
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact Command Log / Overview pills for the desktop detail header. They are
 * toggle buttons rather than tabs, so the set is a named group.
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
        <Button
          key={name}
          size={ButtonSize.Small}
          variant={view === name ? ButtonVariant.Primary : ButtonVariant.Secondary}
          className="!rounded-full"
          aria-pressed={view === name}
          onClick={() => onChange(name)}
        >
          {VIEW_LABEL[name]}
        </Button>
      ))}
    </div>
  );
}

/** Tablet form of the same switch, trailing the panel's own header row. */
export function ThreadViewSelect({
  view,
  onChange,
}: {
  view: ThreadDetailView;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <Select
      size={ButtonSize.Small}
      variant={ButtonVariant.Secondary}
      value={view}
      items={THREAD_DETAIL_VIEWS.map((name) => ({
        id: name,
        label: VIEW_LABEL[name],
      }))}
      onValueChange={(id) =>
        // SAFETY: the ids are built from THREAD_DETAIL_VIEWS above, so every
        // value the picker can emit is a ThreadDetailView.
        onChange(id as ThreadDetailView)
      }
    />
  );
}
