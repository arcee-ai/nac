import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { useTheme } from "@/app/providers/ThemeProvider";

const THEME_ICON = {
  light: IconName.Sun,
  dark: IconName.Moon,
  system: IconName.Desktop,
} as const;

export function ThemeToggle({ size = ButtonSize.Small }: { size?: ButtonSize }) {
  const { theme, resolved, toggleTheme } = useTheme();
  const nextTheme =
    theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const stateLabel =
    theme === "system" ? `system (${resolved})` : theme;
  return (
    <Tooltip
      title={`Theme: ${stateLabel}. Switch to ${nextTheme}`}
      position={TooltipPosition.BottomLeft}
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={size}
        content={ButtonContent.Icon}
        onClick={toggleTheme}
        aria-label={`Theme: ${stateLabel}. Switch to ${nextTheme}`}
        data-theme-mode={theme}
        data-theme-resolved={resolved}
      >
        <Icon iconName={THEME_ICON[theme] ?? IconName.Desktop} />
      </Button>
    </Tooltip>
  );
}
