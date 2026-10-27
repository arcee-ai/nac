import { createContext, useContext, type ReactNode } from "react";

/**
 * What the phone's side box dialog lends the screens drawn inside it: the way
 * out of the dialog, and the panel tab bar a list screen floats at its bottom.
 */
export interface PanelPhoneChrome {
  close: () => void;
  bar: ReactNode;
}

const PanelPhoneChromeContext = createContext<PanelPhoneChrome | null>(null);

export function PanelPhoneChromeProvider({
  value,
  children,
}: {
  value: PanelPhoneChrome;
  children: ReactNode;
}) {
  return (
    <PanelPhoneChromeContext.Provider value={value}>{children}</PanelPhoneChromeContext.Provider>
  );
}

export function usePanelPhoneChrome(): PanelPhoneChrome | null {
  return useContext(PanelPhoneChromeContext);
}
