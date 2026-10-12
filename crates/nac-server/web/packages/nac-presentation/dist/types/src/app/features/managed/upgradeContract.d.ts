import type { ManagedUpgradeOperation, ManagedUpgradeSnapshot } from "./upgrade";
export declare class ManagedUpgradeContractError extends Error {
    constructor();
}
export declare function decodeManagedUpgradeOperation(value: unknown): ManagedUpgradeOperation;
export declare function decodeManagedUpgradeSnapshot(value: unknown): ManagedUpgradeSnapshot;
