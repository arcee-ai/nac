/** Presentation behavior only. This grants no URL, input or native authority. */
export type TerminalLinkMode = "browser" | "native-visible-anchor";
export declare const TerminalLinkModeProvider: import("react").Provider<TerminalLinkMode>;
export declare const useTerminalLinkMode: () => TerminalLinkMode;
