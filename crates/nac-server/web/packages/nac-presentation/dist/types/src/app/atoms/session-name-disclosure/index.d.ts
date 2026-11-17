import { type ReactElement } from "react";
/** Presentation only: callers supply the existing resolver's current display name. */
export declare function useSessionNameDisclosure(name: string, description?: string): {
    hint: (children: ReactElement, disabled?: boolean) => import("react").JSX.Element;
    view: (event: React.MouseEvent<HTMLElement>) => void;
    action: import("react").JSX.Element;
    overlay: import("react").JSX.Element | null;
};
/** A heading's name is itself the explicit read-only disclosure action. */
export default function SessionNameDisclosure({ name, className, running, quietIcon, }: {
    name: string;
    className?: string;
    running?: boolean;
    /** Show the info glyph only on hover or keyboard focus (a page title). */
    quietIcon?: boolean;
}): import("react").JSX.Element;
