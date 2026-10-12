import type { Validation } from "../../lib/apiKey";
/** Green tick, spinner or key, depending on how the key checked out. */
export declare function KeyStatus({ status }: {
    status: Validation["status"];
}): import("react").JSX.Element;
