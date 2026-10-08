declare const modalIdBrand: unique symbol;
/** Opaque identity token of one dialog instance in the shared stack. */
export interface ModalId {
    readonly [modalIdBrand]: true;
}
/**
 * Mint a fresh identity token for one dialog instance. The only way to obtain
 * a `ModalId`, so a token always names a real dialog.
 */
export declare const createModalId: () => ModalId;
export interface ModalStackItem {
    id: ModalId;
}
export declare function createModalStack(): {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => ModalStackItem[];
    pushModal: (item: ModalStackItem) => void;
    popModal: (id: ModalId) => void;
    isModalOnTop: (id: ModalId) => boolean;
    getStackLength: () => number;
};
export declare const ModalStackContext: import("react").Context<{
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => ModalStackItem[];
    pushModal: (item: ModalStackItem) => void;
    popModal: (id: ModalId) => void;
    isModalOnTop: (id: ModalId) => boolean;
    getStackLength: () => number;
} | null>;
export declare const modalStackDepth: () => number;
/**
 * Shared stack for nested dialogs. Mobile uses it to slide lower sheets aside;
 * Escape uses it so only the topmost dialog dismisses.
 */
export declare const useModalStack: () => {
    modalStack: ModalStackItem[];
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => ModalStackItem[];
    pushModal: (item: ModalStackItem) => void;
    popModal: (id: ModalId) => void;
    isModalOnTop: (id: ModalId) => boolean;
    getStackLength: () => number;
};
export {};
