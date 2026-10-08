import { type ReactNode } from "react";
import type { NativeRuntime } from "./nativeRuntime";
export interface NativePresentationRootProps {
    runtime: NativeRuntime;
    /** Caller owns location and navigation; use MemoryRouter for an embedded view. */
    router: (children: ReactNode) => ReactNode;
    /** Theme/styles are explicitly selected. This root never imports a global stylesheet. */
    theme?: (children: ReactNode) => ReactNode;
    className?: string;
    /** Caller explicitly installs the selected stylesheet or scoped style nodes. */
    styles?: ReactNode;
    /** Standalone entry owns document shortcuts; embedded views own focused shortcuts. */
    globalKeyboard?: boolean;
}
export declare function NativePresentationRoot(props: NativePresentationRootProps): import("react").JSX.Element;
