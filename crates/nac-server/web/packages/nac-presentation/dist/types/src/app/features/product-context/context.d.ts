export interface ProductNavigationOwner {
    openMcp(): void;
    openConfigurations(): void;
    openSsh(): void;
    inspect(): void;
}
export declare const ProductNavigationContext: import("react").Context<ProductNavigationOwner | null>;
export declare function useProductNavigationOwner(): ProductNavigationOwner;
