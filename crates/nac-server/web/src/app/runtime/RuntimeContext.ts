import { createContext, useContext } from "react";
import { standaloneRuntime, type RuntimeDependencies } from "./nativeRuntime";

export const RuntimeContext = createContext<RuntimeDependencies | null>(null);
export function useNativeRuntime(): RuntimeDependencies {
  return useContext(RuntimeContext) ?? standaloneRuntime;
}
