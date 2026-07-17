import type { Config } from "tailwindcss";

function themeColor(name: string) {
  return `rgb(var(--color-${name}) / <alpha-value>)`;
}

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Delivera "Architectural Trust" design system. Every value is a CSS
        // variable (defined in globals.css) that flips under `.dark`, so
        // every utility using these tokens is dark-mode-aware automatically.
        surface: themeColor("surface"),
        "surface-dim": themeColor("surface-dim"),
        "surface-bright": themeColor("surface-bright"),
        "surface-alt": themeColor("surface-alt"),
        "surface-container-lowest": themeColor("surface-container-lowest"),
        "surface-container-low": themeColor("surface-container-low"),
        "surface-container": themeColor("surface-container"),
        "surface-container-high": themeColor("surface-container-high"),
        "surface-container-highest": themeColor("surface-container-highest"),
        "surface-variant": themeColor("surface-container-highest"),
        "on-surface": themeColor("on-surface"),
        "on-surface-variant": themeColor("on-surface-variant"),
        outline: themeColor("outline"),
        "outline-variant": themeColor("outline-variant"),
        "border-subtle": themeColor("border-subtle"),
        background: themeColor("background"),
        "on-background": themeColor("on-background"),

        primary: themeColor("primary"),
        "on-primary": themeColor("on-primary"),
        "primary-container": themeColor("primary-container"),
        "on-primary-container": themeColor("on-primary-container"),
        "primary-fixed": themeColor("primary-fixed"),
        "on-primary-fixed-variant": themeColor("on-primary-fixed-variant"),

        secondary: themeColor("secondary"),
        "on-secondary": themeColor("on-secondary"),
        "secondary-container": themeColor("secondary-container"),
        "on-secondary-container": themeColor("on-secondary-container"),

        tertiary: themeColor("tertiary"),
        "on-tertiary": themeColor("on-tertiary"),
        "tertiary-container": themeColor("tertiary-container"),
        "on-tertiary-container": themeColor("on-tertiary-container"),
        "tertiary-fixed": themeColor("tertiary-fixed"),
        "on-tertiary-fixed-variant": themeColor("on-tertiary-fixed-variant"),

        error: themeColor("error"),
        "on-error": themeColor("on-error"),
        "error-container": themeColor("error-container"),
        "on-error-container": themeColor("on-error-container"),

        "action-violet": themeColor("action-violet"),
        "slate-gray": "#64748B",
        "success-emerald": themeColor("success-emerald"),
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        sm: "0.25rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        full: "9999px",
      },
      spacing: {
        "section-gap": "120px",
        "section-gap-mobile": "64px",
        "grid-gutter": "24px",
        "stack-sm": "12px",
        "stack-md": "24px",
        "safe-margin": "5vw",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        headline: ["Hanken Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "label-mono": ["13px", { lineHeight: "1", letterSpacing: "0.05em", fontWeight: "500" }],
        "headline-sm": ["20px", { lineHeight: "1.3", fontWeight: "600" }],
        "headline-md": ["24px", { lineHeight: "1.4", fontWeight: "600" }],
        "headline-lg": ["40px", { lineHeight: "1.2", fontWeight: "700" }],
        "display-hero-mobile": ["40px", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "800" }],
        "display-hero": ["64px", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "800" }],
      },
      boxShadow: {
        glow: "0 8px 40px -8px rgba(53, 37, 205, 0.25)",
      },
    },
  },
  plugins: [],
} satisfies Config;
