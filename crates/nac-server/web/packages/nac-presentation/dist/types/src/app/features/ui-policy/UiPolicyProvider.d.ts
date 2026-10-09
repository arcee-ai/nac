import { type ReactNode } from "react";
import { type NacClient } from "../../services/nacClient";
/** No creation or orchestration surface mounts until this endpoint's policy settles. */
export declare function UiPolicyProvider({ children, client: suppliedClient, }: {
    children: ReactNode;
    client?: NacClient;
}): import("react").JSX.Element;
