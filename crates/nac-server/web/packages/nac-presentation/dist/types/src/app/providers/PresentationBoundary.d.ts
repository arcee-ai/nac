import { type ReactNode } from "react";
import { type LayerStack } from "../ui/layer-stack";
/** Native overlays and background focus stay in the embedding's theme/style boundary. */
export declare function PresentationBoundary({ children, globalKeyboard, }: {
    children: ReactNode;
    globalKeyboard?: boolean;
}): import("react").JSX.Element;
export declare function usePresentationPortalTarget(): HTMLElement;
export declare function usePresentationInertTarget(): HTMLElement | null;
/** Overlay layers of this presentation instance: dialogs, panels and hints. */
export declare function usePresentationLayers(): LayerStack;
/** Embedded shortcuts belong to the view that currently has keyboard focus. */
export declare function usePresentationKeyboardOwner(): (target: EventTarget | null) => boolean;
