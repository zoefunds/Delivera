"use client";

export function ThemeToggle() {
  return (
    <button
      aria-label="Toggle dark mode"
      className="rounded-lg border border-slate-300 p-2 text-sm dark:border-slate-700"
      onClick={() => {
        const dark = document.documentElement.classList.toggle("dark");
        localStorage.theme = dark ? "dark" : "light";
      }}
    >
      <span className="dark:hidden">🌙</span>
      <span className="hidden dark:inline">☀️</span>
    </button>
  );
}
