import type { ReactNode } from "react";
/**
 * One fleet attention subscription for the whole app (one stream serves every
 * tab and view), turned into the Inbox model every surface reads: the
 * sidebar's switch badge, Home's "N need you" line, the list and the palette.
 */
export declare function InboxProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * Opening a session reads its latest outcome on this device: a Failed or
 * Done row clears as soon as you look at it.
 */
export declare function InboxReadMarker({ sessionId }: {
    sessionId: string;
}): null;
