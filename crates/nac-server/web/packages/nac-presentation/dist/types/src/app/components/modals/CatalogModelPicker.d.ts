import { type AriaAttributes } from "react";
import { type CatalogPick } from "../../lib/catalog";
import type { BackendKind, CatalogModel, ModelCatalog, ProviderModel } from "../../types/api";
/** A model row's trailing facts, "1.0M · $0.22/$1.2": input budget, then input/output $ per 1M tokens. */
export declare function ModelFacts({ model }: {
    model: CatalogModel;
}): import("react").JSX.Element | null;
export declare function CatalogModelPicker({ catalog, loading, failed, disabled, compact, liveByBackend, value, onSelect, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, }: {
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
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby">): import("react").JSX.Element;
