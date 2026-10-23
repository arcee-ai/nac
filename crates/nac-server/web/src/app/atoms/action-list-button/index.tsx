import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize } from "../loader";
import TabButton, { TabButtonSize } from "../tab-button";

export enum ActionListButtonStatus {
  Ready = "ready",
  Pending = "pending",
  Running = "running",
  Failed = "failed",
}

interface ActionListButtonProps {
  /** Type icon, shown while Ready. The other statuses bring their own glyph. */
  icon: IconName;
  label: string;
  /** Rendered uppercase. Running and Failed rows drop it. */
  meta?: string;
  status?: ActionListButtonStatus;
  /** Thread rows use the brighter button label tone from the design. */
  prominent?: boolean;
  /** Leave unset on rows that navigate away instead of selecting themselves. */
  selected?: boolean;
  /** `1` is a child row of an expanded group: indented behind a guide line. */
  depth?: 0 | 1;
  /** Only for group rows, which expand and collapse their children. */
  expanded?: boolean;
  onClick?: () => void;
  className?: string;
}

const LABEL_TONE: Record<ActionListButtonStatus, string> = {
  [ActionListButtonStatus.Ready]: "text-basic-secondary",
  [ActionListButtonStatus.Pending]: "text-btn-secondary-disabled",
  [ActionListButtonStatus.Running]: "text-shimmer-basic motion-reduce:animate-none",
  [ActionListButtonStatus.Failed]: "text-basic-secondary",
};

const PROMINENT_LABEL_TONE: Record<ActionListButtonStatus, string> = {
  ...LABEL_TONE,
  [ActionListButtonStatus.Ready]: "text-btn-secondary",
  [ActionListButtonStatus.Failed]: "text-btn-secondary",
};

const STATUS_NAME: Record<ActionListButtonStatus, string | null> = {
  [ActionListButtonStatus.Ready]: null,
  [ActionListButtonStatus.Pending]: "pending",
  [ActionListButtonStatus.Running]: "running",
  [ActionListButtonStatus.Failed]: "failed",
};

function StatusGlyph({ icon, status }: { icon: IconName; status: ActionListButtonStatus }) {
  // The `!` fills beat `.btn-ghost .icon path { fill: … }` from atoms.css, hover included.
  switch (status) {
    case ActionListButtonStatus.Running:
      return <Loader size={LoaderSize.XSmall} className="shrink-0" />;
    case ActionListButtonStatus.Failed:
      return (
        <Icon
          iconName={IconName.Close}
          size={16}
          className="shrink-0 [&>path]:!fill-error-primary"
        />
      );
    case ActionListButtonStatus.Pending:
      return (
        <Icon
          iconName={IconName.Clock}
          size={16}
          className="shrink-0 [&>path]:!fill-btn-secondary-disabled"
        />
      );
    default:
      return <Icon iconName={icon} size={16} className="shrink-0" />;
  }
}

/**
 * One row of the Insights list: a thread, a session, a tool call or a group of
 * them. The caller maps the action type to icon, label and meta; the row only
 * knows its status. It is a small `TabButton`, so hover, press, focus and the
 * selected highlight are the tab button's own. `.btn-small.btn-icon` sets its
 * height and padding in unlayered CSS, which the 36px row overrides with `!`.
 */
const ActionListButton: React.FC<ActionListButtonProps> = ({
  icon,
  label,
  meta,
  status = ActionListButtonStatus.Ready,
  prominent = false,
  selected,
  depth = 0,
  expanded,
  onClick,
  className,
}) => {
  const shownMeta =
    status === ActionListButtonStatus.Running || status === ActionListButtonStatus.Failed
      ? undefined
      : meta;
  const accessibleName = [label, shownMeta, STATUS_NAME[status]].filter(Boolean).join(", ");
  const labelTone = (prominent ? PROMINENT_LABEL_TONE : LABEL_TONE)[status];

  const row = (
    <TabButton
      type="button"
      size={TabButtonSize.Small}
      active={selected === true}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-label={accessibleName}
      onClick={onClick}
      className={cn("!h-9 !px-2", depth === 0 && className)}
    >
      <StatusGlyph icon={icon} status={status} />
      <span className={cn("flex-1 min-w-0 truncate text-left", labelTone)}>{label}</span>
      {shownMeta ? (
        <span className="shrink-0 text-[10px] leading-[12px] uppercase text-basic-muted">
          {shownMeta}
        </span>
      ) : null}
    </TabButton>
  );

  if (depth === 0) return row;

  return (
    <div
      data-action-list-child
      className={cn(
        "relative pl-1",
        "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-divider-muted",
        // Spans the 2px list gap, so consecutive children share one guide line.
        "[[data-action-list-child]+&]:before:-top-0.5",
        className,
      )}
    >
      {row}
    </div>
  );
};

export default ActionListButton;
