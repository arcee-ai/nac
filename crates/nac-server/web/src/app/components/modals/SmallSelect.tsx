import type { AriaAttributes } from "react";
import {
  ButtonSize,
  ButtonVariant,
  IconName,
  PopoverPlacement,
  Select,
  TabButtonSize,
  type SelectItem,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

export function SmallSelect({
  items,
  checkedChoices = false,
  value,
  onValueChange,
  placeholder,
  triggerLabel,
  disabled = false,
  size = ButtonSize.Medium,
  trailingIcon,
  triggerClassName,
  placement = PopoverPlacement.CenterLeft,
  onOpenChange,
  presentation,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: {
  items: SelectItem[];
  checkedChoices?: boolean;
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  triggerLabel?: string;
  disabled?: boolean;
  size?: ButtonSize;
  trailingIcon?: IconName | null;
  triggerClassName?: string;
  placement?: PopoverPlacement;
  onOpenChange?: (open: boolean) => void;
  presentation?: "form";
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-label">) {
  const isMobile = useIsMobile();
  return (
    <Select
      items={items}
      checkedChoices={checkedChoices}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      triggerLabel={triggerLabel}
      disabled={disabled}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      size={presentation === "form" && isMobile ? ButtonSize.Large : size}
      trailingIcon={trailingIcon}
      className={presentation === "form" ? "w-full md:w-auto" : undefined}
      triggerClassName={cn(presentation === "form" && "w-full md:w-[280px]", triggerClassName)}
      itemSize={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
      variant={presentation === "form" ? ButtonVariant.Secondary : ButtonVariant.Ghost}
      placement={placement}
      onOpenChange={onOpenChange}
      // Every form this select appears in scrolls its own body, which clipped
      // the list against the top of the box whenever the row sat near it.
      sticky
      panelClassName="max-h-[200px] overflow-auto min-w-[220px] max-w-[calc(100vw-16px)]"
    />
  );
}
