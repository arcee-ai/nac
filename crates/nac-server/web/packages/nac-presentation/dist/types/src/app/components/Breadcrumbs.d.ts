/**
 * The trail is project-first: `All Projects > [identicon] Project ⌄ ⊕`.
 *
 * Inside a chat the trail names the chat's project rather than the chat itself,
 * because the tab strip below already says which chat is open. A chat that
 * belongs to no project names itself instead, so the trail never goes blank.
 */
export declare function Breadcrumbs(): import("react").JSX.Element;
