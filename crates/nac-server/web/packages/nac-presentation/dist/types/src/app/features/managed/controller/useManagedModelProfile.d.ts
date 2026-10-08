import type { CatalogPick } from "../../../lib/catalog";
export declare function useManagedModelProfile(): {
    defaultPick: CatalogPick | null;
    configured: boolean;
    matches: (pick: CatalogPick | null) => boolean;
    credentialReady: boolean;
    initializing: boolean;
};
