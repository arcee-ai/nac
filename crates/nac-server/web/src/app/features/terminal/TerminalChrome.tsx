import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  HoverHint,
  Icon,
  IconName,
  MessageBox,
  MessageBoxSize,
  MessageBoxVariant,
  Popover,
  PopoverPlacement,
  StickyButton,
  TabButton,
  TabButtonSize,
  TooltipPosition,
} from "@/app/atoms";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import type { TerminalHeading } from "./terminalLabels";

export interface TerminalOption {
  label: string;
  icon: IconName;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The detail of an open terminal: a desktop draws its header here, while a
 * narrower split draws the header itself and lends this its `menuSlot` for
 * the options. Everything the header's hint explains is also spoken.
 *
 * The output's scroller pads its own content rather than sitting inset, so a
 * log, or a grid larger than its box, scrolls to the frame's edges; on a
 * phone, from the top of the screen, under the floating header. xterm's own
 * scrollback stays within that padding.
 */
export function TerminalFrame({
  heading,
  menuSlot,
  options,
  notices = [],
  children,
}: {
  heading: TerminalHeading;
  menuSlot: HTMLElement | null;
  /** Read when the menu opens, so its rows reflect the terminal at that moment. */
  options?: () => readonly TerminalOption[];
  notices?: readonly ReactNode[];
  /** Gets the top padding for the scroller, which depends on what is above it. */
  children: (top: string) => ReactNode;
}) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const menu = options ? <TerminalOptions options={options} /> : null;
  const shown = notices.filter(Boolean);
  const top = isMobile ? "pt-18" : "pt-4";
  return (
    <>
      {!isMobile && !isTablet ? (
        <div className="flex items-center gap-2 h-12 pl-4 pr-2 shrink-0 border-b border-muted bg-elevation-ground">
          <div className="flex flex-1 min-w-0 items-center gap-2">
            <span className="min-w-0 truncate header-sm text-basic-primary">{heading.title}</span>
            <TerminalTag heading={heading} hint />
          </div>
          {menu}
        </div>
      ) : menu && menuSlot ? (
        createPortal(menu, menuSlot)
      ) : null}
      <p className="sr-only">
        {heading.about} · {heading.facts}
      </p>
      <div className="flex flex-col flex-1 min-h-0">
        {shown.length > 0 ? (
          <div className={cn("flex flex-col gap-2 px-4 [&>*]:shrink-0", top)}>{shown}</div>
        ) : null}
        {children(shown.length > 0 ? "pt-4" : top)}
      </div>
    </>
  );
}

/** The design's `Agent` tag after the title, and the hint explaining the terminal. */
export function TerminalTag({
  heading,
  hint = false,
}: {
  heading: TerminalHeading;
  hint?: boolean;
}) {
  return (
    <>
      {heading.agent ? (
        <Badge text="Agent" color={BadgeColor.Blue} background={false} className="shrink-0" />
      ) : null}
      {hint ? (
        // The facts run to several lines, and the header sits just under the
        // panel's tabs: hanging from the glyph keeps the tip off them.
        <HoverHint
          title={heading.about}
          description={heading.facts}
          position={TooltipPosition.RightTop}
          className="shrink-0"
        />
      ) : null}
    </>
  );
}

/** The header's ⋮: a menu beside it, and a sheet on a phone. */
function TerminalOptions({ options }: { options: () => readonly TerminalOption[] }) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const trigger = {
    "aria-label": "Terminal options",
    "aria-expanded": open,
    onClick: () => setOpen((current) => !current),
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.BottomLeft}
      size="w-[251px]"
      sticky
      focusScope="Terminal actions"
      panelClassName="shadow-xl"
      sheetClassName="px-2 rounded-t-[16px] bg-elevation-level-3"
      content={
        <div className="flex flex-col gap-1 [&>*]:shrink-0">
          {options().map((option) => (
            <TabButton
              key={option.label}
              size={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
              disabled={option.disabled}
              onClick={() => {
                setOpen(false);
                option.onSelect();
              }}
            >
              <Icon iconName={option.icon} />
              <span className="text-left flex-grow">{option.label}</span>
            </TabButton>
          ))}
        </div>
      }
    >
      {isMobile ? (
        <StickyButton variant={ButtonVariant.Secondary} content={ButtonContent.Icon} {...trigger}>
          <Icon iconName={IconName.MenuVertical} />
        </StickyButton>
      ) : (
        <Button
          size={ButtonSize.Medium}
          variant={ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          {...trigger}
        >
          <Icon iconName={IconName.MenuVertical} />
        </Button>
      )}
    </Popover>
  );
}

/**
 * A fact about the terminal that the design has no place for: a failure, or
 * the recovery it needs. Only the message is announced; its action follows.
 */
export function TerminalNotice({
  children,
  info = false,
  live = info ? "status" : "alert",
  action,
}: {
  children: ReactNode;
  /** Informational rather than a failure. */
  info?: boolean;
  live?: "alert" | "status";
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 [&>*]:shrink-0">
      <MessageBox
        variant={info ? MessageBoxVariant.Info : MessageBoxVariant.Error}
        size={MessageBoxSize.Small}
        className="w-full"
        title={<span role={live}>{children}</span>}
      />
      {action}
    </div>
  );
}

/** The action a notice offers, sized for the notice it follows. */
export function NoticeAction({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size={ButtonSize.Small}
      variant={ButtonVariant.Secondary}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
