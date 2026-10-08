/**
 * `/project/:id` is an address for a project, but every screen that shows one is
 * really a chat inside it, so this lands on the project's newest chat.
 *
 * A project with no chats yet starts one instead — which is also what happens
 * right after it is created.
 */
export default function ProjectRedirectPage(): import("react").JSX.Element;
