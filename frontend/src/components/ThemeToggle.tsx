"use client";

import { Icon } from "./Icon";

export function ThemeToggle() {
  return (
    <button
      aria-label="Toggle dark mode"
      className="rounded-full p-2 text-on-surface-variant transition-all hover:bg-surface-container-low active:scale-95 dark:hover:bg-white/10"
      onClick={() => {
        const dark = document.documentElement.classList.toggle("dark");
        localStorage.theme = dark ? "dark" : "light";
      }}
    >
      <span className="dark:hidden">
        <Icon name="dark_mode" />
      </span>
      <span className="hidden dark:inline">
        <Icon name="light_mode" />
      </span>
    </button>
  );
}
