import React, { useState } from "react";
import { AnchorPlacement } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import StickyButton from "../button/StickyButton";
import Icon, { IconName } from "../icon";
import Popover, { PopoverSize } from "../popover";
import type { HoverHintConfig } from "../label";
import TabButton, { TabButtonSize, TabButtonVariant } from "../tab-button";

export interface SelectItem {
  id: string;
  label: React.ReactNode;
  icon?: IconName;
  /** Info glyph on the row. Its hover text explains that choice. */
  hoverHint?: HoverHintConfig;
}

interface SelectProps {
  items?: SelectItem[];
  value?: string;
  onValueChange?: (id: string) => void;
  size?: ButtonSize;
  /** Panel rows; defaults to matching `size`. */
  itemSize?: TabButtonSize;
  variant?: ButtonVariant;
  placement?: AnchorPlacement;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Portal the panel to the body, for a select that sits in a box which clips
   * its overflow — a dialog scrolling its own body cuts the list off otherwise.
   * The panel then sizes to its content instead of to the trigger, so a width
   * of its own belongs in `panelClassName`.
   */
  sticky?: boolean;
  /**
   * Draws the trigger as a `StickyButton` of `variant`, for a select floating
   * over a phone screen. Its rows still follow `size`.
   */
  floating?: boolean;
  /** Trigger text in place of the chosen row's label, for a trigger that words it its own way. */
  triggerLabel?: React.ReactNode;
  className?: string;
  /** Glyph after the label, or `null` for a trigger of text alone. Forms keep the disclosure chevron. */
  trailingIcon?: IconName | null;
  /**
   * Applied to the trigger button. The wrapper stretching is not enough on its
   * own — the button hugs its label — so a select that has to fill a form
   * column needs `w-full` here as well as on `className`.
   */
  triggerClassName?: string;
  panelClassName?: string;
  /** Fired when the list opens or closes, so a surrounding tip can step aside. */
  onOpenChange?: (open: boolean) => void;
}

const tabSizeFor = {
  [ButtonSize.Small]: TabButtonSize.Small,
  [ButtonSize.Medium]: TabButtonSize.Medium,
  [ButtonSize.Large]: TabButtonSize.Large,
} satisfies Record<ButtonSize, TabButtonSize>;

/** Dropdown select: a `Popover` whose panel is a list of single-choice rows. */
const Select: React.FC<SelectProps> = ({
  items = [],
  value,
  onValueChange,
  size = ButtonSize.Medium,
  itemSize,
  variant = ButtonVariant.Secondary,
  placement = AnchorPlacement.BottomRight,
  placeholder = "Select...",
  disabled = false,
  sticky = false,
  floating = false,
  triggerLabel,
  className = "",
  trailingIcon = IconName.Down,
  triggerClassName = "",
  panelClassName = "",
  onOpenChange,
}) => {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);
  const rowSize = itemSize ?? tabSizeFor[size];

  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const select = (id: string) => {
    onValueChange?.(id);
    changeOpen(false);
  };

  const trigger = {
    variant,
    disabled,
    content: trailingIcon ? ButtonContent.IconRight : ButtonContent.Text,
    onClick: () => !disabled && changeOpen(!open),
    "aria-expanded": open,
  };
  const triggerClass = `${triggerClassName} overflow-hidden max-w-full`;
  const triggerFace = (
    <>
      {selected?.icon && triggerLabel === undefined ? <Icon iconName={selected.icon} /> : null}
      <span className="text-left flex-grow truncate md:max-w-full">
        {triggerLabel ?? selected?.label ?? placeholder}
      </span>
      {trailingIcon ? (
        <Icon
          iconName={trailingIcon}
          className={cn(
            trailingIcon === IconName.Down && "transition-transform duration-150 ease-out",
            trailingIcon === IconName.Down && (open ? "rotate-180" : "rotate-0"),
          )}
        />
      ) : null}
    </>
  );

  return (
    <Popover
      open={open}
      onClose={() => changeOpen(false)}
      placement={placement}
      // A fixed panel measures `min-w-full` against the viewport rather than
      // against the trigger, so a portalled list hugs its content instead.
      size={sticky ? PopoverSize.Fit : "min-w-full"}
      sticky={sticky}
      className={className}
      panelClassName={panelClassName}
      content={
        <div className="flex flex-col gap-1 px-2 md:px-0">
          {items.map((item) => (
            <TabButton
              key={item.id}
              size={rowSize}
              variant={TabButtonVariant.Regular}
              active={item.id === value}
              hoverHint={item.hoverHint}
              onClick={() => select(item.id)}
            >
              {item.icon ? <Icon iconName={item.icon} /> : null}
              <span className="text-left flex-grow">{item.label}</span>
            </TabButton>
          ))}
        </div>
      }
    >
      {floating ? (
        <StickyButton {...trigger} buttonClassName={triggerClass}>
          {triggerFace}
        </StickyButton>
      ) : (
        <Button {...trigger} size={size} className={triggerClass}>
          {triggerFace}
        </Button>
      )}
    </Popover>
  );
};

export default Select;
