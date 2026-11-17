import React from "react";
import { ToastVariant } from "../atoms/toast/Toast";
import type { RunError } from "../lib/providerError";
export { ToastVariant };
interface ToastOptions {
    /** Seconds before the toast dismisses itself. */
    life?: number;
    /** Keep the toast until it is dismissed explicitly. */
    keep?: boolean;
}
interface ToastApi {
    addToast: (params: {
        content: React.ReactNode;
        variant?: ToastVariant;
    } & ToastOptions) => string;
    removeToast: (id: string) => void;
    clearToasts: () => void;
    info: (content: React.ReactNode, options?: ToastOptions) => string;
    success: (content: React.ReactNode, options?: ToastOptions) => string;
    error: (content: React.ReactNode, options?: ToastOptions) => string;
    danger: (content: React.ReactNode, options?: ToastOptions) => string;
}
export declare function ToastProvider({ children }: {
    children: React.ReactNode;
}): React.JSX.Element;
export declare function useToast(): ToastApi;
/** Format a rejection for display in a toast. */
export declare function errorMessage(error: RunError): string;
