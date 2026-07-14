import { html } from "../lib/html.js";
import { Icon } from "../atoms/icon.js";
import { Button, ButtonVariant, ButtonSize, ButtonContent } from "../atoms/button.js";
import { Tooltip } from "../atoms/tooltip.js";
import { useTheme } from "../providers/ThemeProvider.js";

const THEME_ICON = { light: "sun", dark: "moon", system: "desktop" };

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return html`<${Tooltip} title=${`Theme: ${theme} (click to cycle)`} position="bottom-left">
    <${Button}
      variant=${ButtonVariant.Ghost}
      size=${ButtonSize.Small}
      content=${ButtonContent.Icon}
      onClick=${toggleTheme}
      aria-label=${`Theme: ${theme}`}
    >
      <${Icon} name=${THEME_ICON[theme] || "desktop"} />
    </${Button}>
  </${Tooltip}>`;
}
