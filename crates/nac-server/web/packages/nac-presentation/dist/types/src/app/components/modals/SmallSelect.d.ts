import { ButtonSize, IconName, PopoverPlacement, type SelectItem } from "../../atoms";
export declare function SmallSelect({ items, value, onValueChange, placeholder, disabled, size, trailingIcon, triggerClassName, placement, onOpenChange, }: {
    items: SelectItem[];
    value: string;
    onValueChange: (id: string) => void;
    placeholder?: string;
    disabled?: boolean;
    size?: ButtonSize;
    trailingIcon?: IconName;
    triggerClassName?: string;
    placement?: PopoverPlacement;
    onOpenChange?: (open: boolean) => void;
}): import("react").JSX.Element;
