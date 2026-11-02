import { createContext, useContext } from "react";
export interface ProductNavigationOwner {
  openMcp(): void;
  openConfigurations(): void;
  openSsh(): void;
  inspect(): void;
}
export const ProductNavigationContext = createContext<ProductNavigationOwner | null>(null);
export function useProductNavigationOwner() {
  const owner = useContext(ProductNavigationContext);
  if (!owner) throw new Error("Product navigation requires an attached presentation.");
  return owner;
}
