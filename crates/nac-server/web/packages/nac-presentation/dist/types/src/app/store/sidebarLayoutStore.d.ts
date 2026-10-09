/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createSidebarLayoutStore(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    storedOpen: () => boolean | null;
    storeOpen: (value: boolean) => void;
    setSidebarOffset: (offset: number) => void;
    useSidebarOffset: () => number;
};
export declare const release: () => void, storedOpen: () => boolean | null, storeOpen: (value: boolean) => void, setSidebarOffset: (offset: number) => void, useSidebarOffset: () => number;
