import { type RuntimeDependencies } from "./nativeRuntime.js";
export declare const RuntimeContext: import("react").Context<RuntimeDependencies | null>;
export declare function useNativeRuntime(): RuntimeDependencies;
