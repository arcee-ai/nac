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
import { cn } from "@/app/lib/cn";
import { THEMES, useTheme, type Theme } from "@/app/providers/ThemeProvider";

const THEME_ICON = {
  light: IconName.Sun,
  dark: IconName.Moon,
  system: IconName.Desktop,
} as const;

const THEME_LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** One quiet icon button that cycles System → Light → Dark. */
export function ThemeToggle({ size = ButtonSize.Medium }: { size?: ButtonSize }) {
  const { theme = "system", toggleTheme } = useTheme();
  return (
    <Tooltip title={`Theme: ${THEME_LABEL[theme]}`} position={TooltipPosition.TopLeft}>
      <Button
        variant={ButtonVariant.Ghost}
        size={size}
        content={ButtonContent.Icon}
        onClick={toggleTheme}
        aria-label={`Theme: ${THEME_LABEL[theme]}`}
      >
        <Icon iconName={THEME_ICON[theme] ?? IconName.Desktop} />
      </Button>
    </Tooltip>
  );
}

/** System / Light / Dark as a segmented control (Settings › Appearance). */
export function ThemeSegmented({ className }: { className?: string }) {
  const { theme = "system", setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-pill bg-[var(--f-wash-2)] p-0.5",
        className,
      )}
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          onClick={() => setTheme?.(option)}
          className={cn(
            "type-label inline-flex h-7 items-center gap-1.5 rounded-pill px-3 transition-colors duration-150",
            theme === option
              ? "bg-elevation-level-1 text-basic-primary shadow-md"
              : "text-basic-tertiary hover:text-basic-primary",
          )}
        >
          <Icon iconName={THEME_ICON[option]} size={14} />
          {THEME_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
