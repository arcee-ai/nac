import type { ReactNode } from "react";
export declare function SteeringPromptModal({ open, title, subheader, value, submitting, disabled, footerLeading, onChange, onClose, onSubmit, }: {
    open: boolean;
    title: string;
    subheader?: string;
    value: string;
    submitting: boolean;
    disabled?: boolean;
    footerLeading?: ReactNode;
    onChange: (value: string) => void;
    onClose: () => void;
    onSubmit: () => void;
}): import("react").JSX.Element;
