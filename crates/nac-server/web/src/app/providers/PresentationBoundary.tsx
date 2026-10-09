import { createContext, useContext, useCallback, useState, type ReactNode } from "react";
import { createModalStack, ModalStackContext } from "../hooks/useModalStack";

interface Boundary {
  portal: HTMLElement;
  content: HTMLElement;
  globalKeyboard: boolean;
}
const BoundaryContext = createContext<Boundary | null>(null);

/** Native overlays and background focus stay in the embedding's theme/style boundary. */
export function PresentationBoundary({
  children,
  globalKeyboard = false,
}: {
  children: ReactNode;
  globalKeyboard?: boolean;
}) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [stack] = useState(createModalStack);
  return (
    <>
      <div ref={setPortal} data-nac-overlays="" />
      <div ref={setContent} className="h-full min-h-0" data-nac-content="">
        {portal && content ? (
          <BoundaryContext.Provider value={{ portal, content, globalKeyboard }}>
            <ModalStackContext.Provider value={stack}>{children}</ModalStackContext.Provider>
          </BoundaryContext.Provider>
        ) : null}
      </div>
    </>
  );
}

export function usePresentationPortalTarget(): HTMLElement {
  return useContext(BoundaryContext)?.portal ?? document.body;
}
export function usePresentationInertTarget(): HTMLElement | null {
  return useContext(BoundaryContext)?.content ?? document.getElementById("root");
}

/** Embedded shortcuts belong to the view that currently has keyboard focus. */
export function usePresentationKeyboardOwner() {
  const boundary = useContext(BoundaryContext);
  const portal = boundary?.portal;
  const content = boundary?.content;
  const globalKeyboard = boundary?.globalKeyboard ?? true;
  return useCallback(
    (target: EventTarget | null) =>
      globalKeyboard ||
      (target instanceof Node && (!!portal?.contains(target) || !!content?.contains(target))),
    [globalKeyboard, portal, content],
  );
}
