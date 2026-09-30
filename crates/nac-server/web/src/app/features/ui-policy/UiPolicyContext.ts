import { createContext, useContext } from "react";
import { DIRECT_UI_POLICY, type UiPolicy } from "./policy";

export const UiPolicyContext = createContext<UiPolicy>(DIRECT_UI_POLICY);
export function useUiPolicy() {
  return useContext(UiPolicyContext);
}
