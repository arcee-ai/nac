//! The app's icons, drawn for a 16 point box in the stroke style of dogfood's (Lucide's) set.

use rune::Icon;

macro_rules! icon {
    ($name:ident, $id:literal, $body:literal) => {
        pub static $name: Icon = Icon { name: $id, view: 16.0, body: $body };
    };
}

icon!(PLUS, "nac-plus", r#"<path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>"#);
icon!(
    SEARCH,
    "nac-search",
    r#"<circle cx="7.25" cy="7.25" r="4" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M10.25 10.25L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>"#
);
icon!(
    GRID,
    "nac-grid",
    r#"<rect x="2.75" y="2.75" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="9.25" y="2.75" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="2.75" y="9.25" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="9.25" y="9.25" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/>"#
);
icon!(
    FOLDER,
    "nac-folder",
    r#"<path d="M2.5 4.75C2.5 4.06 3.06 3.5 3.75 3.5H6.2L7.6 5H12.25C12.94 5 13.5 5.56 13.5 6.25V11.25C13.5 11.94 12.94 12.5 12.25 12.5H3.75C3.06 12.5 2.5 11.94 2.5 11.25Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>"#
);
icon!(
    GEAR,
    "nac-gear",
    r#"<path d="M7.06 3.60L7.21 1.95L8.79 1.95L8.94 3.60L10.45 4.22L11.72 3.16L12.84 4.28L11.78 5.55L12.40 7.06L14.05 7.21L14.05 8.79L12.40 8.94L11.78 10.45L12.84 11.72L11.72 12.84L10.45 11.78L8.94 12.40L8.79 14.05L7.21 14.05L7.06 12.40L5.55 11.78L4.28 12.84L3.16 11.72L4.22 10.45L3.60 8.94L1.95 8.79L1.95 7.21L3.60 7.06L4.22 5.55L3.16 4.28L4.28 3.16L5.55 4.22Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2" fill="none"/>"#
);
icon!(
    SUN,
    "nac-sun",
    r#"<circle cx="8" cy="8" r="2.75" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 1.75V3M8 13V14.25M1.75 8H3M13 8H14.25M3.58 3.58L4.46 4.46M11.54 11.54L12.42 12.42M12.42 3.58L11.54 4.46M4.46 11.54L3.58 12.42" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>"#
);
icon!(
    MOON,
    "nac-moon",
    r#"<path d="M13 9.4A5.25 5.25 0 1 1 6.6 3A4.2 4.2 0 0 0 13 9.4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>"#
);
icon!(CHEVRON, "nac-chevron", r#"<path d="M6 3.75L10.25 8L6 12.25" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>"#);
icon!(
    ARROW_UP,
    "nac-arrow-up",
    r#"<path d="M8 12.5V3.5M4 7.25L8 3.25L12 7.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>"#
);
icon!(STOP, "nac-stop", r#"<rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" fill="currentColor"/>"#);
icon!(
    TOOL,
    "nac-tool",
    r#"<path d="M4.5 5.75L6.75 8L4.5 10.25M8.25 10.5H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="2.25" y="3.25" width="11.5" height="9.5" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/>"#
);
icon!(
    THOUGHT,
    "nac-thought",
    r#"<path d="M8 2.5L9.3 6.7L13.5 8L9.3 9.3L8 13.5L6.7 9.3L2.5 8L6.7 6.7Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>"#
);
icon!(
    ALERT,
    "nac-alert",
    r#"<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 5.25V8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="10.75" r="0.8" fill="currentColor"/>"#
);
icon!(
    SHIELD,
    "nac-shield",
    r#"<path d="M8 2.25L12.75 4V7.75C12.75 10.6 10.75 12.75 8 13.75C5.25 12.75 3.25 10.6 3.25 7.75V4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>"#
);
icon!(CLOSE, "nac-close", r#"<path d="M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>"#);
