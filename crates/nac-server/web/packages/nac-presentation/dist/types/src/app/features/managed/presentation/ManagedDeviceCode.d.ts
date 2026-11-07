import type { DeviceLoginStarted } from "../../../types/api";
/**
 * The code a pending provider sign-in asks the user to type on the provider's
 * page, with the three things they can do about it: copy it, open the page,
 * or give up. Copy places exactly the code shown here on the clipboard and says
 * through a live region whether that worked, so the outcome is heard as well
 * as seen and a denied clipboard leaves the user knowing to copy by hand.
 */
export declare function ManagedDeviceCode({ prompt, label, onCancel, }: {
    prompt: DeviceLoginStarted;
    label: string;
    onCancel: () => void;
}): import("react").JSX.Element;
