import { createContext, useContext } from "react";

import { NATIVE_NEW_SESSION_KEYS, NEW_SESSION_KEYS } from "@/app/lib/shortcuts";

/** Whether a native app menu delivers workspace commands to this presentation. */
export const NativeMenuContext = createContext(false);
export const useNativeMenu = () => useContext(NativeMenuContext);

/** The New session chord to advertise: the native menu's where it exists. */
export function useNewSessionKeys(): string[] {
  return useNativeMenu() ? NATIVE_NEW_SESSION_KEYS : NEW_SESSION_KEYS;
}
