import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The typography scale in `theme/typography.css` is hand-written CSS whose names
 * land in Tailwind's `text-*` namespace. Left undeclared, tailwind-merge reads
 * `text-micro` as a colour and drops it the moment a real colour follows, so
 * every `cn("text-micro", "text-basic-tertiary")` silently lost its size.
 * Declaring the sizes puts them in the font-size group, where they only ever
 * displace each other.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["big", "medium", "small", "micro"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
