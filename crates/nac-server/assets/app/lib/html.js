// htm bound to React.createElement. Vendored React/htm are UMD globals loaded
// before this module runs. No JSX, no build step.
export const React = window.React;
export const { createElement, Fragment } = window.React;
export const html = window.htm.bind(window.React.createElement);
