import { createContext, useContext } from "react";
import type { SettingsSection } from "@/app/lib/routes";

/**
 * Settings destinations. Each one navigates to its Settings section; nothing
 * here opens a dialog any more.
 */
export interface ProductNavigationOwner {
  openMcp(): void;
  openConfigurations(): void;
  openSsh(): void;
  /** Settings › Capabilities, scoped to the session on screen (if any). */
  inspect(): void;
  openSettings(section?: SettingsSection): void;
}
export const ProductNavigationContext = createContext<ProductNavigationOwner | null>(null);
export function useProductNavigationOwner() {
  const owner = useContext(ProductNavigationContext);
  if (!owner) throw new Error("Product navigation requires an attached presentation.");
  return owner;
}
