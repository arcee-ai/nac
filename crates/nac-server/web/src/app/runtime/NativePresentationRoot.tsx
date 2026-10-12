import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "../../App";
import { PresentationBoundary } from "../providers/PresentationBoundary";
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";
import { RuntimeContext } from "./RuntimeContext";
import type { NativeRuntime } from "./nativeRuntime";

export interface NativePresentationRootProps {
  runtime: NativeRuntime;
  /** Caller owns location and navigation; use MemoryRouter for an embedded view. */
  router: (children: ReactNode) => ReactNode;
  /** Theme/styles are explicitly selected. This root never imports a global stylesheet. */
  theme?: (children: ReactNode) => ReactNode;
  className?: string;
  /** Caller explicitly installs the selected stylesheet or scoped style nodes. */
  styles?: ReactNode;
  /** Standalone entry owns document shortcuts; embedded views own focused shortcuts. */
  globalKeyboard?: boolean;
}

export function NativePresentationRoot(props: NativePresentationRootProps) {
  return <RuntimePresentation key={props.runtime.id} {...props} />;
}

function RuntimePresentation({
  runtime,
  router,
  theme,
  className,
  styles,
  globalKeyboard,
}: NativePresentationRootProps) {
  useEffect(() => runtime.retain(), [runtime]);
  const closed = useSyncExternalStore(runtime.subscribe, runtime.isClosed, runtime.isClosed);
  if (closed) return null;
  const view = (
    <ThemedPresentation
      runtime={runtime}
      className={className}
      styles={styles}
      globalKeyboard={globalKeyboard}
    >
      {router(<App />)}
    </ThemedPresentation>
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        {theme ? theme(view) : <ThemeProvider local>{view}</ThemeProvider>}
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

/** Theme classes belong to the same local boundary as content and overlays. */
function ThemedPresentation({
  runtime,
  className,
  styles,
  globalKeyboard,
  children,
}: Pick<NativePresentationRootProps, "runtime" | "className" | "styles" | "globalKeyboard"> & {
  children: ReactNode;
}) {
  const { resolved } = useTheme();
  return (
    <div
      className={`${className ?? "nac-presentation h-full min-h-0"} ${resolved}`}
      style={{ contain: "layout paint" }}
      data-nac-runtime={runtime.id}
      data-theme={resolved}
    >
      {styles}
      <PresentationBoundary globalKeyboard={globalKeyboard}>{children}</PresentationBoundary>
    </div>
  );
}
