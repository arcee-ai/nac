// Radix's modal mode locks page scrolling and hides everything outside the open
// layer from assistive technology across the whole document, which would reach
// into every other presentation instance on the page. The per-instance layer
// stack owns both, so the primitives always run Radix non-modal and the build
// resolves `react-remove-scroll` and `aria-hidden` to this module instead.
function unsupported(name: string): never {
  throw new Error(
    `${name} belongs to Radix's modal mode: keep the primitive non-modal and let the presentation layer stack lock scrolling and inert the background.`,
  );
}

export function RemoveScroll(): never {
  return unsupported("RemoveScroll");
}

export function hideOthers(): never {
  return unsupported("hideOthers");
}
