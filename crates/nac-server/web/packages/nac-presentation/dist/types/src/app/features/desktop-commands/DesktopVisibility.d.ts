import { type ReactNode } from "react";
import { type DesktopVisibilityPort } from "./visibility";
/** WK keeps the document on close; native visibility is an explicit fact.
 * Browser-only views remain unchanged and acquire no native listener. */
export declare function DesktopVisibility({ port, children, }: {
    port?: DesktopVisibilityPort;
    children: ReactNode;
}): import("react").JSX.Element;
