/** Whether a native app menu delivers workspace commands to this presentation. */
export declare const NativeMenuContext: import("react").Context<boolean>;
export declare const useNativeMenu: () => boolean;
/** The New session chord to advertise: the native menu's where it exists. */
export declare function useNewSessionKeys(): string[];
