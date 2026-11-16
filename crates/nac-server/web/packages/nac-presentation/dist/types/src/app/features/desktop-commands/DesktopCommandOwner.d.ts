import { type DesktopCommandPort } from "./adapter";
/** One connected owner per presentation; routing/dialog/focus remain shared. */
export declare function DesktopCommandOwner({ port }: {
    port: DesktopCommandPort;
}): null;
