import { type CatalogPick } from "../../lib/catalog";
import type { BackendKind, ModelCatalog, ProviderModel } from "../../types/api";
export declare function CatalogModelPicker({ catalog, loading, failed, disabled, compact, liveByBackend, value, onSelect, }: {
    catalog: ModelCatalog | undefined;
    loading: boolean;
    failed: boolean;
    /** Prevents a seed pick while an authoritative managed index is settling. */
    disabled?: boolean;
    /** Compact composer trigger; the searchable unified panel stays identical. */
    compact?: boolean;
    liveByBackend: Map<BackendKind, ProviderModel[] | null>;
    value: CatalogPick | null;
    onSelect: (pick: CatalogPick) => void;
}): import("react").JSX.Element;
