import { useUiPolicy } from "./UiPolicyContext";

/**
 * Whether session-type glyphs are drawn (Figma `isNacEnable`). Without NAC
 * orchestration every session is a direct agent, so the glyph would tell
 * nothing apart.
 */
export function useSessionBehaviorIconVisible(): boolean {
  return useUiPolicy().orchestrationEnabled;
}
