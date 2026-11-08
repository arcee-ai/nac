import { createContext, useContext } from "react";

export interface DesktopVisibilityPort {
  connectVisibility?(owner: (visible: boolean) => void): () => void;
}
export const DesktopVisibilityContext = createContext(true);
export const useDesktopVisible = () => useContext(DesktopVisibilityContext);
