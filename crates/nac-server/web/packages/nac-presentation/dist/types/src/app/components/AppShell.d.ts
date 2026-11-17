/**
 * The app frame. Wide screens have no app bar: each page owns its 52px header
 * (and the sidebar its own). Phones get the minimal header everywhere except a
 * session, whose own header covers the phone, and Settings, which has its own.
 */
export declare function AppShell(): import("react").JSX.Element;
