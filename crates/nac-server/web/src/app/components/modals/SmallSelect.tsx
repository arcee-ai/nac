import {
  ButtonSize,
  ButtonVariant,
  PopoverPlacement,
  Select,
  TabButtonSize,
  type SelectItem,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

export function SmallSelect({
  items,
  value,
  onValueChange,
  placeholder,
  disabled = false,
}: {
  items: SelectItem[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();
  return (
    <Select
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      disabled={disabled}
      size={ButtonSize.Medium}
      itemSize={isMobile ? TabButtonSize.Large : TabButtonSize.Medium}
      variant={ButtonVariant.Ghost}
      placement={PopoverPlacement.CenterLeft}
      panelClassName="max-h-[200px] overflow-auto min-w-[220px]"
    />
  );
}
