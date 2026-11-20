import type { AriaAttributes } from "react";
import { ButtonSize, IconName, PopoverPlacement, type SelectItem } from "../../atoms";
export declare function SmallSelect({ items, checkedChoices, value, onValueChange, placeholder, triggerLabel, disabled, size, trailingIcon, triggerClassName, placement, onOpenChange, presentation, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, "aria-label": ariaLabel, }: {
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
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-label">): import("react").JSX.Element;
