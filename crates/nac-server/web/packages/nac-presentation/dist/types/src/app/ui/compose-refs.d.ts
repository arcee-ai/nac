import type { Ref, RefCallback } from "react";
/** One callback ref that feeds the node to every ref it is given, cleanups included. */
export declare function composeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T>;
