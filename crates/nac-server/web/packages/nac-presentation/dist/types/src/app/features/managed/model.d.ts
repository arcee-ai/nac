import type { CatalogPick } from "../../lib/catalog";
import type { ManagedCloneOperation, ManagedHostStatus, ModelCatalog, ProviderModelsRequest } from "../../types/api";
export type ManagedTab = "status" | "github" | "secrets";
export declare const MANAGED_TABS: readonly ManagedTab[];
export declare function managedSecretNameError(name: string): string;
export declare function repositoryIdentity(fullName: string | null | undefined): [string, string] | null;
export declare function cloneIsRunning(operation: ManagedCloneOperation | null): boolean;
type ManagedModelHostStatus = Pick<ManagedHostStatus, "model" | "model_ready">;
export declare function managedModelPick(status: ManagedModelHostStatus | null): CatalogPick | null;
export declare function matchesManagedModelPick(status: ManagedModelHostStatus | null, pick: CatalogPick | null): boolean;
/** Every server-owned provider account can discover its models without BYOK. */
export declare function readyProviderModelRequests(catalog: ModelCatalog | undefined, status: ManagedModelHostStatus | null): ProviderModelsRequest[];
export {};
