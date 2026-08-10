/** @type {import('tailwindcss').Config} */
const config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "spin-reverse": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(-360deg)" },
        },
        "spin-reverse-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(-360deg)" },
        },
        progress: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "text-shimmer": {
          "0%": {
            backgroundPosition: "200% 0",
          },
          "100%": {
            backgroundPosition: "-200% 0",
          },
        },
        "loader-gradient-move": {
          "0%": { backgroundPosition: "200% 0%" },
          "100%": { backgroundPosition: "0% 0%" },
        },
        "pulse-opacity": {
          "0%": { opacity: "0" },
          "50%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        "spin-reverse": "spin-reverse 1s linear infinite",
        "spin-slow": "spin 1.5s linear infinite",
        "spin-reverse-slow": "spin-reverse-slow 1.5s linear infinite",
        progress: "progress 1.5s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        "text-shimmer": "text-shimmer 2s linear infinite",
        "loader-gradient-move": "loader-gradient-move 2s linear infinite",
        "pulse-opacity": "pulse-opacity 1s ease-in-out infinite",
      },
      backgroundImage: {
        "text-shimmer":
          "linear-gradient(90deg, var(--color-text-accent-primary), var(--color-text-accent-tertiary), var(--color-text-accent-primary))",
        "text-shimmer-dark":
          "linear-gradient(90deg, var(--color-text-accent-primary), var(--color-text-accent-tertiary), var(--color-text-accent-primary))",
      },
      backgroundColor: {
        "accent-primary": "var(--color-bg-accent-primary)",
        "accent-secondary": "var(--color-bg-accent-secondary)",
        "accent-tertiary": "var(--color-bg-accent-tertiary)",
        "accent-inverse": "var(--color-bg-accent-inverse)",

        "btn-primary": "var(--color-bg-btn-primary)",
        "btn-primary-hovered": "var(--color-bg-btn-primary-hovered)",
        "btn-primary-pressed": "var(--color-bg-btn-primary-pressed)",
        "btn-primary-disabled": "var(--color-bg-btn-primary-disabled)",
        "btn-secondary": "var(--color-bg-btn-secondary)",
        "btn-secondary-hovered": "var(--color-bg-btn-secondary-hovered)",
        "btn-secondary-pressed": "var(--color-bg-btn-secondary-pressed)",
        "btn-secondary-disabled": "var(--color-bg-btn-secondary-disabled)",
        "btn-secondary-highlighted":
          "var(--color-bg-btn-secondary-highlighted)",
        "btn-secondary-highlighted-hovered":
          "var(--color-bg-btn-secondary-highlighted-hovered)",
        "btn-secondary-highlighted-pressed":
          "var(--color-bg-btn-secondary-highlighted-pressed)",
        "btn-secondary-highlighted-disabled":
          "var(--color-bg-btn-secondary-highlighted-disabled)",
        "btn-ghost": "var(--color-bg-btn-ghost)",
        "btn-ghost-hovered": "var(--color-bg-btn-ghost-hovered)",
        "btn-ghost-pressed": "var(--color-bg-btn-ghost-pressed)",
        "btn-ghost-disabled": "var(--color-bg-btn-ghost-disabled)",
        "btn-ghost-highlighted": "var(--color-bg-btn-ghost-highlighted)",
        "btn-ghost-highlighted-hovered":
          "var(--color-bg-btn-ghost-highlighted-hovered)",
        "btn-ghost-highlighted-pressed":
          "var(--color-bg-btn-ghost-highlighted-pressed)",
        "btn-ghost-highlighted-disabled":
          "var(--color-bg-btn-ghost-highlighted-disabled)",
        "btn-secondary-destructive":
          "var(--color-bg-btn-secondary-destructive)",
        "btn-secondary-destructive-hovered":
          "var(--color-bg-btn-secondary-destructive-hovered)",
        "btn-secondary-destructive-pressed":
          "var(--color-bg-btn-secondary-destructive-pressed)",
        "btn-secondary-destructive-disabled":
          "var(--color-bg-btn-secondary-destructive-disabled)",
        "btn-ghost-destructive": "var(--color-bg-btn-ghost-destructive)",
        "btn-ghost-destructive-hovered":
          "var(--color-bg-btn-ghost-destructive-hovered)",
        "btn-ghost-destructive-pressed":
          "var(--color-bg-btn-ghost-destructive-pressed)",
        "btn-ghost-destructive-disabled":
          "var(--color-bg-btn-ghost-destructive-disabled)",
        "btn-secondary-accent": "var(--color-bg-btn-secondary-accent)",
        "btn-secondary-accent-hovered":
          "var(--color-bg-btn-secondary-accent-hovered)",
        "btn-secondary-accent-disabled":
          "var(--color-bg-btn-secondary-accent-disabled)",
        "btn-secondary-accent-pressed":
          "var(--color-bg-btn-secondary-accent-pressed)",
        "btn-secondary-accent-highlighted":
          "var(--color-bg-btn-secondary-accent-highlighted)",
        "btn-secondary-accent-highlighted-hovered":
          "var(--color-bg-btn-secondary-accent-highlighted-hovered)",
        "btn-secondary-accent-highlighted-pressed":
          "var(--color-bg-btn-secondary-accent-highlighted-pressed)",
        "btn-secondary-accent-highlighted-disabled":
          "var(--color-bg-btn-secondary-accent-highlighted-disabled)",
        "btn-ghost-accent": "var(--color-bg-btn-ghost-accent)",
        "btn-ghost-accent-hovered": "var(--color-bg-btn-ghost-accent-hovered)",
        "btn-ghost-accent-pressed": "var(--color-bg-btn-ghost-accent-pressed)",
        "btn-ghost-accent-disabled":
          "var(--color-bg-btn-ghost-accent-disabled)",
        "btn-ghost-accent-highlighted":
          "var(--color-bg-btn-ghost-accent-highlighted)",
        "btn-ghost-accent-highlighted-hovered":
          "var(--color-bg-btn-ghost-accent-highlighted-hovered)",
        "btn-ghost-accent-highlighted-pressed":
          "var(--color-bg-btn-ghost-accent-highlighted-pressed)",
        "btn-ghost-accent-highlighted-disabled":
          "var(--color-bg-btn-ghost-accent-highlighted-disabled)",

        "danger-primary": "var(--color-bg-danger-primary)",
        "danger-secondary": "var(--color-bg-danger-secondary)",
        "danger-tertiary": "var(--color-bg-danger-tertiary)",
        "danger-inverse": "var(--color-bg-danger-inverse)",

        "divider-primary": "var(--color-bg-divider-primary)",
        "divider-secondary": "var(--color-bg-divider-secondary)",
        "divider-tertiary": "var(--color-bg-divider-tertiary)",
        "divider-muted": "var(--color-bg-divider-muted)",

        "elevation-ground": "var(--color-bg-elevation-ground)",
        "elevation-level-0-5": "var(--color-bg-elevation-level-0-5)",
        "elevation-ground-inverse": "var(--color-bg-elevation-ground-inverse)",
        "elevation-level-1": "var(--color-bg-elevation-level-1)",
        "elevation-level-2": "var(--color-bg-elevation-level-2)",
        "elevation-level-3": "var(--color-bg-elevation-level-3)",
        "elevation-sublevel-variant-A":
          "var(--color-bg-elevation-sublevel-variant-A)",
        "elevation-sublevel-variant-B":
          "var(--color-bg-elevation-sublevel-variant-B)",

        "code-input-content": "var(--color-bg-code-input-content)",
        "code-input-content-integration":
          "var(--color-bg-code-input-content-integration)",
        "code-input-line-numbers": "var(--color-bg-code-input-line-numbers)",
        "code-input-header": "var(--color-bg-code-input-header)",

        "error-primary": "var(--color-bg-error-primary)",
        "error-secondary": "var(--color-bg-error-secondary)",
        "error-tertiary": "var(--color-bg-error-tertiary)",
        "error-inverse": "var(--color-bg-error-inverse)",

        "info-primary": "var(--color-bg-info-primary)",
        "info-secondary": "var(--color-bg-info-secondary)",
        "info-tertiary": "var(--color-bg-info-tertiary)",
        "info-inverse": "var(--color-bg-info-inverse)",

        "input-switcher": "var(--color-bg-input-switcher)",
        "input-switcher-disabled": "var(--color-bg-input-switcher-disabled)",
        "input-knob": "var(--color-bg-input-knob)",
        "input-knob-disabled": "var(--color-bg-input-knob-disabled)",
        "input-switcher-active": "var(--color-bg-input-switcher-active)",
        "input-switcher-active-disabled":
          "var(--color-bg-input-switcher-active-disabled)",
        "input-knob-active": "var(--color-bg-input-knob-active)",
        "input-knob-active-disabled":
          "var(--color-bg-input-knob-active-disabled)",
        "input-progress": "var(--color-bg-input-progress)",
        "input-progress-bar": "var(--color-bg-input-progress-bar)",
        "input-progress-disabled": "var(--color-bg-input-progress-disabled)",
        "input-progress-bar-disabled":
          "var(--color-bg-input-progress-bar-disabled)",
        input: "var(--color-bg-input)",
        "input-disabled": "var(--color-bg-input-disabled)",

        "success-primary": "var(--color-bg-success-primary)",
        "success-secondary": "var(--color-bg-success-secondary)",
        "success-tertiary": "var(--color-bg-success-tertiary)",
        "success-inverse": "var(--color-bg-success-inverse)",

        scrollbar: "var(--color-bg-scrollbar)",
      },
      textColor: {
        "accent-primary": "var(--color-text-accent-primary)",
        "accent-secondary": "var(--color-text-accent-secondary)",
        "accent-tertiary": "var(--color-text-accent-tertiary)",
        "accent-muted": "var(--color-text-accent-muted)",

        "basic-primary": "var(--color-text-basic-primary)",
        "basic-secondary": "var(--color-text-basic-secondary)",
        "basic-tertiary": "var(--color-text-basic-tertiary)",
        "basic-muted": "var(--color-text-basic-muted)",

        "basic-primary-inverse": "var(--color-text-basic-primary-inverse)",
        "basic-secondary-inverse": "var(--color-text-basic-secondary-inverse)",
        "basic-tertiary-inverse": "var(--color-text-basic-tertiary-inverse)",
        "basic-muted-inverse": "var(--color-text-basic-muted-inverse)",

        "btn-primary": "var(--color-text-btn-primary)",
        "btn-primary-disabled": "var(--color-text-btn-primary-disabled)",
        "btn-accent": "var(--color-text-btn-accent)",
        "btn-accent-hovered": "var(--color-text-btn-accent-hovered)",
        "btn-accent-pressed": "var(--color-text-btn-accent-pressed)",
        "btn-accent-disabled": "var(--color-text-btn-accent-disabled)",
        "btn-secondary": "var(--color-text-btn-secondary)",
        "btn-secondary-hovered": "var(--color-text-btn-secondary-hovered)",
        "btn-secondary-pressed": "var(--color-text-btn-secondary-pressed)",
        "btn-secondary-disabled": "var(--color-text-btn-secondary-disabled)",
        "btn-ghost": "var(--color-text-btn-ghost)",
        "btn-ghost-hovered": "var(--color-text-btn-ghost-hovered)",
        "btn-ghost-pressed": "var(--color-text-btn-ghost-pressed)",
        "btn-ghost-disabled": "var(--color-text-btn-ghost-disabled)",
        "btn-destructive": "var(--color-text-btn-destructive)",
        "btn-destructive-hovered": "var(--color-text-btn-destructive-hovered)",
        "btn-destructive-pressed": "var(--color-text-btn-destructive-pressed)",
        "btn-destructive-disabled":
          "var(--color-text-btn-destructive-disabled)",

        "danger-primary": "var(--color-text-danger-primary)",
        "danger-secondary": "var(--color-text-danger-secondary)",
        "danger-tertiary": "var(--color-text-danger-tertiary)",
        "danger-muted": "var(--color-text-danger-muted)",

        "error-primary": "var(--color-text-error-primary)",
        "error-secondary": "var(--color-text-error-secondary)",
        "error-tertiary": "var(--color-text-error-tertiary)",
        "error-muted": "var(--color-text-error-muted)",

        "info-primary": "var(--color-text-info-primary)",
        "info-secondary": "var(--color-text-info-secondary)",
        "info-tertiary": "var(--color-text-info-tertiary)",
        "info-muted": "var(--color-text-info-muted)",

        input: "var(--color-text-input)",
        "input-disabled": "var(--color-text-input-disabled)",
        "input-placeholder": "var(--color-text-input-placeholder)",
        "input-placeholder-disabled":
          "var(--color-text-input-placeholder-disabled)",

        "primary-inverse": "var(--color-text-primary-inverse)",
        "secondary-inverse": "var(--color-text-secondary-inverse)",
        "tertiary-inverse": "var(--color-text-tertiary-inverse)",
        "muted-inverse": "var(--color-text-muted-inverse)",

        notification: "var(--color-text-notification)",

        "success-primary": "var(--color-text-success-primary)",
        "success-secondary": "var(--color-text-success-secondary)",
        "success-tertiary": "var(--color-text-success-tertiary)",
        "success-muted": "var(--color-text-success-muted)",
      },
      borderColor: {
        "accent-primary": "var(--color-border-accent-primary)",
        "accent-secondary": "var(--color-border-accent-secondary)",
        "accent-tertiary": "var(--color-border-accent-tertiary)",
        "accent-muted": "var(--color-border-accent-muted)",

        primary: "var(--color-border-primary)",
        secondary: "var(--color-border-secondary)",
        tertiary: "var(--color-border-tertiary)",
        muted: "var(--color-border-muted)",

        "code-input": "var(--color-border-code-input)",
        "code-input-hovered": "var(--color-border-code-input-hovered)",

        "danger-primary": "var(--color-border-danger-primary)",
        "danger-secondary": "var(--color-border-danger-secondary)",
        "danger-tertiary": "var(--color-border-danger-tertiary)",
        "danger-muted": "var(--color-border-danger-muted)",

        "error-primary": "var(--color-border-error-primary)",
        "error-secondary": "var(--color-border-error-secondary)",
        "error-tertiary": "var(--color-border-error-tertiary)",
        "error-muted": "var(--color-border-error-muted)",

        "info-primary": "var(--color-border-info-primary)",
        "info-secondary": "var(--color-border-info-secondary)",
        "info-tertiary": "var(--color-border-info-tertiary)",
        "info-muted": "var(--color-border-info-muted)",

        "primary-inversed": "var(--color-border-primary-inversed)",
        "secondary-inversed": "var(--color-border-secondary-inversed)",
        "tertiary-inversed": "var(--color-border-tertiary-inversed)",
        "muted-inversed": "var(--color-border-muted-inversed)",

        "success-primary": "var(--color-border-success-primary)",
        "success-secondary": "var(--color-border-success-secondary)",
        "success-tertiary": "var(--color-border-success-tertiary)",
        "success-muted": "var(--color-border-success-muted)",
      },
      fill: {
        "accent-primary": "var(--color-fill-accent-primary)",
        "accent-secondary": "var(--color-fill-accent-secondary)",
        "accent-tertiary": "var(--color-fill-accent-tertiary)",
        "accent-muted": "var(--color-fill-accent-muted)",

        "basic-primary": "var(--color-fill-basic-primary)",
        "basic-secondary": "var(--color-fill-basic-secondary)",
        "basic-tertiary": "var(--color-fill-basic-tertiary)",
        "basic-muted": "var(--color-fill-basic-muted)",

        "btn-primary": "var(--color-fill-btn-primary)",
        "btn-primary-disabled": "var(--color-fill-btn-primary-disabled)",
        "btn-accent": "var(--color-fill-btn-accent)",
        "btn-accent-hovered": "var(--color-fill-btn-accent-hovered)",
        "btn-accent-pressed": "var(--color-fill-btn-accent-pressed)",
        "btn-accent-muted": "var(--color-fill-btn-accent-muted)",
        "btn-secondary": "var(--color-fill-btn-secondary)",
        "btn-secondary-hovered": "var(--color-fill-btn-secondary-hovered)",
        "btn-secondary-pressed": "var(--color-fill-btn-secondary-pressed)",
        "btn-secondary-disabled": "var(--color-fill-btn-secondary-disabled)",
        "btn-destructive": "var(--color-fill-btn-destructive)",
        "btn-destructive-hovered": "var(--color-fill-btn-destructive-hovered)",
        "btn-destructive-pressed": "var(--color-fill-btn-destructive-pressed)",
        "btn-destructive-disabled":
          "var(--color-fill-btn-destructive-disabled)",

        "danger-primary": "var(--color-fill-danger-primary)",
        "danger-secondary": "var(--color-fill-danger-secondary)",
        "danger-tertiary": "var(--color-fill-danger-tertiary)",
        "danger-muted": "var(--color-fill-danger-muted)",

        "error-primary": "var(--color-fill-error-primary)",
        "error-secondary": "var(--color-fill-error-secondary)",
        "error-tertiary": "var(--color-fill-error-tertiary)",
        "error-muted": "var(--color-fill-error-muted)",

        "info-primary": "var(--color-fill-info-primary)",
        "info-secondary": "var(--color-fill-info-secondary)",
        "info-tertiary": "var(--color-fill-info-tertiary)",
        "info-muted": "var(--color-fill-info-muted)",

        "primary-inversed": "var(--color-fill-primary-inversed)",
        "secondary-inversed": "var(--color-fill-secondary-inversed)",
        "tertiary-inversed": "var(--color-fill-tertiary-inversed)",
        "muted-inversed": "var(--color-fill-muted-inversed)",

        notification: "var(--color-fill-notification)",

        "success-primary": "var(--color-fill-success-primary)",
        "success-secondary": "var(--color-fill-success-secondary)",
        "success-tertiary": "var(--color-fill-success-tertiary)",
        "success-muted": "var(--color-fill-success-muted)",
      },
      colors: {
        brand: {
          50: "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          250: "var(--brand-250)",
          300: "var(--brand-300)",
          400: "var(--brand-400)",
          450: "var(--brand-450)",
          500: "var(--brand-500)",
          550: "var(--brand-550)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
          950: "var(--brand-950)",
        },
      },
      boxShadow: {
        none: "none",
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        "3xl": "var(--shadow-3xl)",
        convex: "var(--shadow-convex)",
        concave: "var(--shadow-concave)",
        "left-sidebar-closed": "var(--left-sidebar-closed)",
        "left-sidebar-open": "var(--left-sidebar-open)",
      },
      screens: {
        "3xl": "1920px",
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        ".text-shimmer-accent": {
          "background-image":
            "linear-gradient(90deg, var(--color-text-accent-primary), var(--color-text-accent-tertiary), var(--color-text-accent-primary))",
          "background-size": "200% 100%",
          "background-position": "200% 0",
          animation: "shimmer 2s linear infinite",
          "-webkit-background-clip": "text",
          "background-clip": "text",
          "-webkit-text-fill-color": "transparent",
          color: "transparent",
        },
        ".text-shimmer-basic": {
          "background-image":
            "linear-gradient(90deg, var(--color-text-basic-secondary), var(--color-text-basic-muted), var(--color-text-basic-secondary))",
          "background-size": "200% 100%",
          "background-position": "200% 0",
          animation: "shimmer 2s linear infinite",
          "-webkit-background-clip": "text",
          "background-clip": "text",
          "-webkit-text-fill-color": "transparent",
          color: "transparent",
        },
      });
    },
  ],
};

export default config;
