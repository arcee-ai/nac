/**
 * The tools a session can reach for are worth one tap from anywhere, so they
 * sit in the bar rather than behind the menu. The phone drops the label and
 * takes the floating pill form the width already uses for its own controls.
 *
 * The count is of servers a new session will actually connect to: a disabled
 * server is kept in the config but never started, so it does not count, and
 * with none enabled the badge is absent rather than a zero.
 */
export declare function McpServersButton({ onOpen }: {
    onOpen: () => void;
}): import("react").JSX.Element;
