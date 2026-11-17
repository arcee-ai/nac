/**
 * `/project/:id` is an address for a project, but every screen that shows one is
 * really a session inside it, so this lands on the project's newest session.
 *
 * A project with no sessions yet opens Home's composer pointed at it (the one
 * new-session flow), replacing this entry so Back does not bounce here.
 */
export default function ProjectRedirectPage(): import("react").JSX.Element;
