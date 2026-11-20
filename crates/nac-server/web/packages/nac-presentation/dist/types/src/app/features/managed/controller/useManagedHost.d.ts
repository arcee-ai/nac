import type { ManagedHostStatus } from "../../../types/api";
export interface ManagedHostActions {
    status: ManagedHostStatus | null;
    isManaged: boolean;
    isUnmanaged: boolean;
    openSettings: () => void;
    addRepository: () => void;
}
export declare const ManagedHostContext: import("react").Context<ManagedHostActions | null>;
export declare function useManagedHost(): ManagedHostActions;
