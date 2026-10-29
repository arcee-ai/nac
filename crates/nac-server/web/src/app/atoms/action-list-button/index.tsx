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

/** The design's RWD: Small is the desktop row, Large the phone's touch row. */
export enum ActionListButtonSize {
  Small = "small",
  Large = "large",
}

const SIZE_STYLE: Record<
  ActionListButtonSize,
  { button: TabButtonSize; box: string | null; glyph: number; loader: LoaderSize }
> = {
  [ActionListButtonSize.Small]: {
    button: TabButtonSize.Small,
    box: "!h-7 !px-2",
    glyph: 16,
    loader: LoaderSize.XSmall,
  },
  [ActionListButtonSize.Large]: {
    button: TabButtonSize.Large,
    box: null,
    glyph: 24,
    loader: LoaderSize.Medium,
  },
};

interface ActionListButtonProps {
  /**
   * Type icon, shown while Ready. The other statuses bring their own glyph,
   * and a group row shows its disclosure chevron in every status instead.
   */
  icon: IconName;
  label: string;
  /** Rendered uppercase, in every status; the caller leaves it out where a row has none. */
  meta?: string;
  status?: ActionListButtonStatus;
  size?: ActionListButtonSize;
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

function Chevron({ expanded, size }: { expanded: boolean; size: number }) {
  return (
    <Icon
      iconName={IconName.Right}
      size={size}
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
  size,
}: {
  icon: IconName;
  status: ActionListButtonStatus;
  expanded: boolean | undefined;
  size: ActionListButtonSize;
}) {
  const { glyph, loader } = SIZE_STYLE[size];
  if (expanded !== undefined) return <Chevron expanded={expanded} size={glyph} />;
  // The `!` colors beat `.btn-ghost .icon { color: … }` from atoms.css, hover included.
  switch (status) {
    case ActionListButtonStatus.Running:
      return <Loader size={loader} className="shrink-0" />;
    case ActionListButtonStatus.Failed:
      return (
        <Icon
          iconName={IconName.Close}
          size={glyph}
          className="shrink-0 !text-fill-btn-destructive"
        />
      );
    case ActionListButtonStatus.Pending:
      return (
        <Icon
          iconName={IconName.Clock}
          size={glyph}
          className="shrink-0 !text-fill-btn-secondary-disabled"
        />
      );
    default:
      return <Icon iconName={icon} size={glyph} className="shrink-0" />;
  }
}

/**
 * One row of the Insights list: a thread, a session, a tool call or a group of
 * them. The caller maps the action type to icon, label and meta; the row only
 * knows its status. It is a `TabButton`, so hover, press, focus and the
 * selected highlight are the tab button's own. The phone's Large row is the
 * large tab button as it stands; `.btn-small.btn-icon` sets the small one's
 * height and padding in unlayered CSS, which the 28px row overrides with `!`.
 */
const ActionListButton: React.FC<ActionListButtonProps> = ({
  icon,
  label,
  meta,
  status = ActionListButtonStatus.Ready,
  size = ActionListButtonSize.Small,
  selected,
  expanded,
  onClick,
  className,
}) => {
  const style = SIZE_STYLE[size];
  const accessibleName = [label, meta, STATUS_NAME[status]].filter(Boolean).join(", ");

  return (
    <TabButton
      type="button"
      size={style.button}
      active={selected === true}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-label={accessibleName}
      disabled={onClick === null}
      onClick={onClick ?? undefined}
      className={cn(style.box, className)}
    >
      <StatusGlyph icon={icon} status={status} expanded={expanded} size={size} />
      <span className={cn("flex-1 min-w-0 truncate text-left", LABEL_TONE[status])}>{label}</span>
      {meta ? (
        <span className="shrink-0 text-[10px] leading-[12px] uppercase text-basic-muted">
          {meta}
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
