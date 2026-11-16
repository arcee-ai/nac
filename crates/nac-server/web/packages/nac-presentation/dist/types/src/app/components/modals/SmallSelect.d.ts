import type { AriaAttributes } from "react";
import { ButtonSize, IconName, PopoverPlacement, type SelectItem } from "../../atoms";
export declare function SmallSelect({ items, value, onValueChange, placeholder, disabled, size, trailingIcon, triggerClassName, placement, onOpenChange, presentation, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, }: {
    items: SelectItem[];
    value: string;
    onValueChange: (id: string) => void;
    placeholder?: string;
    disabled?: boolean;
    size?: ButtonSize;
    trailingIcon?: IconName | null;
    triggerClassName?: string;
    placement?: PopoverPlacement;
    onOpenChange?: (open: boolean) => void;
    presentation?: "form";
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby">): import("react").JSX.Element;
