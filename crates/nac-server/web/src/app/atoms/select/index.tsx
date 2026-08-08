import React, { useState } from "react";
import { AnchorPlacement } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import Popover from "../popover";
import TabButton, { TabButtonSize, TabButtonVariant } from "../tab-button";

export interface SelectItem {
  id: string;
  label: React.ReactNode;
  icon?: IconName;
}

interface SelectProps {
  items?: SelectItem[];
  value?: string;
  onValueChange?: (id: string) => void;
  size?: ButtonSize;
  variant?: ButtonVariant;
  placement?: AnchorPlacement;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Applied to the trigger button. The wrapper stretching is not enough on its
   * own — the button hugs its label — so a select that has to fill a form
   * column needs `w-full` here as well as on `className`.
   */
  triggerClassName?: string;
  panelClassName?: string;
}

const tabSizeFor: Record<ButtonSize, TabButtonSize> = {
  [ButtonSize.Small]: TabButtonSize.Small,
  [ButtonSize.Medium]: TabButtonSize.Medium,
  [ButtonSize.Large]: TabButtonSize.Large,
};

/** Dropdown select: a `Popover` whose panel is a list of single-choice rows. */
const Select: React.FC<SelectProps> = ({
  items = [],
  value,
  onValueChange,
  size = ButtonSize.Medium,
  variant = ButtonVariant.Secondary,
  placement = AnchorPlacement.BottomRight,
  placeholder = "Select...",
  disabled = false,
  className = "",
  triggerClassName = "",
  panelClassName = "",
}) => {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);

  const select = (id: string) => {
    onValueChange?.(id);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={placement}
      size="min-w-full"
      className={className}
      panelClassName={panelClassName}
      content={
        <div className="flex flex-col gap-1 px-2 md:px-0">
          {items.map((item) => (
            <TabButton
              key={item.id}
              size={tabSizeFor[size]}
              variant={TabButtonVariant.Regular}
              active={item.id === value}
              onClick={() => select(item.id)}
            >
              {item.icon ? <Icon iconName={item.icon} /> : null}
              <span className="text-left flex-grow">{item.label}</span>
            </TabButton>
          ))}
        </div>
      }
    >
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        content={ButtonContent.IconRight}
        className={`${triggerClassName} overflow-hidden max-w-full`}
        onClick={() => !disabled && setOpen(!open)}
        aria-expanded={open}
      >
        {selected?.icon ? <Icon iconName={selected.icon} /> : null}
        <span className="text-left flex-grow truncate md:max-w-full">
          {selected?.label ?? placeholder}
        </span>
        <Icon
          iconName={IconName.Down}
          className={cn(
            "transition-transform duration-150 ease-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </Button>
    </Popover>
  );
};

export default Select;
