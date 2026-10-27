import { type SessionPanel } from "../../lib/routes";
/**
 * The phone's panel switcher: a floating bar pinned to the bottom of a list
 * screen in the side box dialog, standing in for the tab row a wide box fits
 * in its header.
 */
export declare function MobileBottomBar({ panel, onPanelChange, panels, }: {
    panel: SessionPanel;
    onPanelChange: (panel: SessionPanel) => void;
    panels?: readonly SessionPanel[];
}): import("react").JSX.Element;
