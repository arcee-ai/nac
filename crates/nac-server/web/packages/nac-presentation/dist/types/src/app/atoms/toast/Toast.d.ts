import React from "react";
export declare enum ToastVariant {
    Info = "info",
    Success = "success",
    Error = "error",
    Danger = "danger"
}
interface ToastProps {
    content: React.ReactNode | string;
    variant: ToastVariant;
    dismissing: boolean;
    onClose: () => void;
}
declare const Toast: React.FC<ToastProps>;
export default Toast;
