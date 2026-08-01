import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
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
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
}

const tabSizeFor: Record<ButtonSize, TabButtonSize> = {
  [ButtonSize.Small]: TabButtonSize.Small,
  [ButtonSize.Medium]: TabButtonSize.Medium,
  [ButtonSize.Large]: TabButtonSize.Large,
};

/**
 * Self-contained dropdown select. Replaces the ArceeFM Selector, which depends
 * on the Popover wrapper and its mobile bottom-sheet variant.
 */
const Select: React.FC<SelectProps> = ({
  items = [],
  value,
  onValueChange,
  size = ButtonSize.Medium,
  variant = ButtonVariant.Secondary,
  placeholder = "Select...",
  disabled = false,
  className = "",
  panelClassName = "",
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = items.find((item) => item.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const select = (id: string) => {
    onValueChange?.(id);
    setOpen(false);
  };

  return (
    <div className={cn("relative w-fit", className)} ref={rootRef}>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        content={ButtonContent.IconRight}
        onClick={() => !disabled && setOpen(!open)}
      >
        {selected?.icon ? <Icon iconName={selected.icon} /> : null}
        <span className="text-left flex-grow truncate">
          {selected?.label ?? placeholder}
        </span>
        <Icon
          iconName={IconName.Down}
          className={cn(
            "transition-transform duration-300 ease-in-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </Button>
      {open ? (
        <div
          className={cn(
            "absolute z-20 mt-1 min-w-full flex flex-col gap-1 p-2 rounded-[8px] fade",
            "bg-elevation-level-2 shadow-2xl",
            panelClassName,
          )}
        >
          {items.map((item) => (
            <TabButton
              key={item.id}
              size={tabSizeFor[size]}
              variant={
                item.id === value
                  ? TabButtonVariant.Accent
                  : TabButtonVariant.Regular
              }
              active={item.id === value}
              onClick={() => select(item.id)}
            >
              {item.icon ? <Icon iconName={item.icon} /> : null}
              <span className="text-left flex-grow">{item.label}</span>
            </TabButton>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default Select;
