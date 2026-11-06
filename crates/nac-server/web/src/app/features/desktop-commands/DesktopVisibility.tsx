import { useLayoutEffect, useState, type ReactNode } from "react";
import { DesktopVisibilityContext, type DesktopVisibilityPort } from "./visibility";

/** WK keeps the document on close; native visibility is an explicit fact.
 * Browser-only views remain unchanged and acquire no native listener. */
export function DesktopVisibility({
  port,
  children,
}: {
  port?: DesktopVisibilityPort;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    if (!port?.connectVisibility) return;
    let active = true;
    const close = port.connectVisibility((next) => {
      if (active) setVisible(next);
    });
    return () => {
      active = false;
      close();
    };
  }, [port]);
  return (
    <DesktopVisibilityContext.Provider value={visible}>
      {children}
    </DesktopVisibilityContext.Provider>
  );
}
