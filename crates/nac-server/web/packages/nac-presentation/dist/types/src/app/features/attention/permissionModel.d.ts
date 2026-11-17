import type { PermissionApprovalMode, PermissionRequest } from "../../types/api";
type Resource = PermissionRequest["resources"][number];
export declare const MODE_OPTIONS: {
    mode: PermissionApprovalMode;
    name: string;
    description: string;
}[];
export declare function modeName(mode: PermissionApprovalMode | undefined): string;
export declare function actionLabel(action: string): string;
export interface PermissionPresentation {
    /** Tool-specific question: "Run this command?", "Edit file?", "Use tool?". */
    title: string;
    /** The resources the question is about, in the broker's order. */
    primary: Resource[];
    /** Every other resource the same reply authorizes. Nothing is left out. */
    secondary: Resource[];
    /** Whether the primary text is a command line, which reads best unwrapped. */
    command: boolean;
}
/**
 * What a request asks, for the card above the composer. It only arranges the
 * broker's own resources; every one of them stays on screen, because each is
 * part of what a single reply authorizes.
 */
export declare function presentPermission(request: PermissionRequest): PermissionPresentation;
export interface RememberedScope {
    action: string;
    /** Exactly what the broker stores for "always", byte for byte. */
    scope: string;
}
/** The grants an "always" reply would store: one per resource carrying a save pattern. */
export declare function rememberedScopes(request: PermissionRequest | null): RememberedScope[];
/**
 * A readable spelling of a stored command pattern: `command:[git][status]*`
 * reads `git status *`. Anything else is returned unchanged, so a pattern the
 * client does not understand is never paraphrased.
 */
export declare function readableScope(scope: string): string;
/** The label for the "always" choice, naming the rule when there is exactly one. */
export declare function alwaysAllowLabel(scopes: RememberedScope[]): string;
export {};
