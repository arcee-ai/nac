import {
  ButtonSize,
  ButtonVariant,
  PopoverPlacement,
  Select,
  type SelectItem,
} from "@/app/atoms";

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
  return (
    <Select
      items={items}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      disabled={disabled}
      size={ButtonSize.Medium}
      variant={ButtonVariant.Ghost}
      placement={PopoverPlacement.CenterLeft}
      panelClassName="max-h-[200px] overflow-auto min-w-[220px]"
    />
  );
}
