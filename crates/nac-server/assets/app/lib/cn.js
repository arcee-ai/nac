// Class name helper. clsx is a vendored UMD global. tailwind-merge is optional
// (we control our classes); add later if conflict-resolution is needed.
const clsx = window.clsx;

export function cn(...inputs) {
  return clsx(inputs);
}
