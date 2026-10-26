import { type ReactNode } from "react";
import type { ItemContext } from "./itemContent";
import type { SessionLink } from "../useDelegatedSessions";
export declare function BodyText({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function SuccessText({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function FileChip({ path, name }: {
    path: string;
    name: string;
}): import("react").JSX.Element;
/** Rendered only for a session the delegation records confirm. */
export declare function SessionLinkButton({ link, context, }: {
    link: SessionLink | null;
    context: ItemContext;
}): import("react").JSX.Element | null;
export declare function ReasoningText({ text, streaming }: {
    text: string;
    streaming: boolean;
}): import("react").JSX.Element;
