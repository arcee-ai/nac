import { createContext } from "react";

/** Optional lifetime for explicit fold choices in child previews. */
export const FoldChoicesContext = createContext<Map<string, boolean> | null>(null);
