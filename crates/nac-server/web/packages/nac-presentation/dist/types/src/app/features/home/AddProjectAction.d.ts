/**
 * The shared "Add project" action: the creation form locally; on a managed host, the
 * choice between adding a repository and creating from a path already there.
 */
export declare function AddProjectAction({ touch, iconOnly, beforeCreate, }: {
    touch?: boolean;
    iconOnly?: boolean;
    beforeCreate?: () => void;
}): import("react").JSX.Element;
