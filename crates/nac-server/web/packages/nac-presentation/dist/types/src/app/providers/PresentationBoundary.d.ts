import { type ReactNode } from "react";
/** Native overlays and background focus stay in the embedding's theme/style boundary. */
export declare function PresentationBoundary({ children, globalKeyboard, }: {
    children: ReactNode;
    globalKeyboard?: boolean;
}): import("react").JSX.Element;
export declare function usePresentationPortalTarget(): HTMLElement;
export declare function usePresentationInertTarget(): HTMLElement | null;
/** Embedded shortcuts belong to the view that currently has keyboard focus. */
export declare function usePresentationKeyboardOwner(): (target: EventTarget | null) => boolean;
