import { type ReactNode } from "react";
/**
 * What the phone's side box dialog lends the screens drawn inside it: the way
 * out of the dialog, and the panel tab bar a list screen floats at its bottom.
 */
export interface PanelPhoneChrome {
    close: () => void;
    bar: ReactNode;
}
export declare function PanelPhoneChromeProvider({ value, children, }: {
    value: PanelPhoneChrome;
    children: ReactNode;
}): import("react").JSX.Element;
export declare function usePanelPhoneChrome(): PanelPhoneChrome | null;
