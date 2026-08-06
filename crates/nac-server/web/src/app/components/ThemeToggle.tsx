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
  const { theme, toggleTheme } = useTheme();
  return (
    <Tooltip
      title={`Theme: ${theme} (click to cycle)`}
      position={TooltipPosition.BottomLeft}
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={size}
        content={ButtonContent.Icon}
        onClick={toggleTheme}
        aria-label={`Theme: ${theme}`}
      >
        <Icon iconName={THEME_ICON[theme] ?? IconName.Desktop} />
      </Button>
    </Tooltip>
  );
}
