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
  /**
   * Type icon, shown while Ready. The other statuses bring their own glyph,
   * and a group row shows its disclosure chevron in every status instead.
   */
  icon: IconName;
  label: string;
  /** Rendered uppercase. Running and Failed rows drop it. */
  meta?: string;
  status?: ActionListButtonStatus;
  /** Leave unset on rows that navigate away instead of selecting themselves. */
  selected?: boolean;
  /** Only for group rows, which expand and collapse their children. */
  expanded?: boolean;
  /** Null for a row with nowhere to go, which then takes no focus. */
  onClick?: (() => void) | null;
  className?: string;
}

/** Ready and Failed labels take the tab button's own tone, so they follow its highlight and hover. */
const LABEL_TONE: Partial<Record<ActionListButtonStatus, string>> = {
  [ActionListButtonStatus.Pending]: "text-btn-secondary-disabled",
  [ActionListButtonStatus.Running]: "text-shimmer-basic motion-reduce:animate-none",
};

const STATUS_NAME: Record<ActionListButtonStatus, string | null> = {
  [ActionListButtonStatus.Ready]: null,
  [ActionListButtonStatus.Pending]: "pending",
  [ActionListButtonStatus.Running]: "running",
  [ActionListButtonStatus.Failed]: "failed",
};

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <Icon
      iconName={IconName.Right}
      size={16}
      className={cn(
        "shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
        expanded && "rotate-90",
      )}
    />
  );
}

function StatusGlyph({
  icon,
  status,
  expanded,
}: {
  icon: IconName;
  status: ActionListButtonStatus;
  expanded: boolean | undefined;
}) {
  if (expanded !== undefined) return <Chevron expanded={expanded} />;
  // The `!` fills beat `.btn-ghost .icon path { fill: … }` from atoms.css, hover included.
  switch (status) {
    case ActionListButtonStatus.Running:
      return <Loader size={LoaderSize.XSmall} className="shrink-0" />;
    case ActionListButtonStatus.Failed:
      return (
        <Icon
          iconName={IconName.Close}
          size={16}
          className="shrink-0 [&>path]:!fill-btn-destructive"
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
 * height and padding in unlayered CSS, which the 28px row overrides with `!`.
 */
const ActionListButton: React.FC<ActionListButtonProps> = ({
  icon,
  label,
  meta,
  status = ActionListButtonStatus.Ready,
  selected,
  expanded,
  onClick,
  className,
}) => {
  const shownMeta =
    status === ActionListButtonStatus.Running || status === ActionListButtonStatus.Failed
      ? undefined
      : meta;
  const accessibleName = [label, shownMeta, STATUS_NAME[status]].filter(Boolean).join(", ");

  return (
    <TabButton
      type="button"
      size={TabButtonSize.Small}
      active={selected === true}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-label={accessibleName}
      disabled={onClick === null}
      onClick={onClick ?? undefined}
      className={cn("!h-7 !px-2", className)}
    >
      <StatusGlyph icon={icon} status={status} expanded={expanded} />
      <span className={cn("flex-1 min-w-0 truncate text-left", LABEL_TONE[status])}>{label}</span>
      {shownMeta ? (
        <span className="shrink-0 text-[10px] leading-[12px] uppercase text-basic-muted">
          {shownMeta}
        </span>
      ) : null}
    </TabButton>
  );
};

/**
 * The child rows of an expanded group, or the threads of one wave, behind a
 * single guide line that runs 4px past the first and the last row. The rows
 * sit 8px in from the line's outer edge, the 1px line included.
 */
export function ActionListSegment({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-l border-primary py-1 pl-[7px] [&>*]:shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default ActionListButton;
