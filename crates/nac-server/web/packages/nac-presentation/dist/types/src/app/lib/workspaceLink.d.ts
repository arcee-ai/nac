/**
 * How a markdown href should be handled in the chat: open elsewhere, open in
 * the Files panel, or swallow the click so HashRouter does not dump the user
 * on the homescreen.
 */
export type MarkdownHrefKind = {
    kind: "external";
    href: string;
} | {
    kind: "workspace";
    path: string;
} | {
    kind: "blocked";
};
/**
 * `react-markdown`'s default transform drops `file:` (and Windows drive
 * letters), which is exactly what agents emit for workspace files. Keep those,
 * still reject anything else with a scheme (`javascript:` etc.).
 */
export declare function markdownUrlTransform(value: string): string;
/**
 * Turn a markdown href into a workspace-relative path the Files panel can open,
 * or say it is an ordinary external link / unresolvable file reference.
 */
export declare function classifyMarkdownHref(href: string | undefined, hostRoots?: Array<string | null | undefined>): MarkdownHrefKind;
