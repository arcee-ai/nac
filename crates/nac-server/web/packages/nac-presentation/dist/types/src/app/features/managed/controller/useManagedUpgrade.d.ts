import { type ManagedUpgradeBlocker } from "../upgrade";
export type UpgradeBlockerSettlement = "requesting" | "settling" | "failed";
/**
 * Browser controller for the externally-owned durable upgrade. It never
 * invents a host, incarnation, channel, or target: the only start payload is
 * the controller contract's exact empty object, and blocker controls invoke
 * the ordinary NAC operations named by the sanitized facade projection.
 */
export declare function useManagedUpgrade(): {
    snapshot: import("@tanstack/react-query").UseQueryResult<NoInfer<import("../upgrade").ManagedUpgradeSnapshot>, Error>;
    confirmationOpen: boolean;
    startError: string;
    startPending: boolean;
    settlements: Record<string, UpgradeBlockerSettlement>;
    requestStart: () => void;
    cancelStart: () => void;
    confirmStart: () => Promise<void>;
    requestSettlement: (blocker: ManagedUpgradeBlocker) => Promise<void>;
};
