import { createContext, useContext } from "react";

/** Presentation behavior only. This grants no URL, input or native authority. */
export type TerminalLinkMode = "browser" | "native-visible-anchor";
const TerminalLinkModeContext = createContext<TerminalLinkMode>("browser");
export const TerminalLinkModeProvider = TerminalLinkModeContext.Provider;
export const useTerminalLinkMode = () => useContext(TerminalLinkModeContext);
