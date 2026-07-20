"use client";

export default function ThemeToggle() {
  function toggleTheme() {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    window.localStorage.setItem("review-lab-theme", next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
      className="grid h-9 w-9 place-items-center rounded-lg text-base text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-50"
    >
      <span aria-hidden className="dark:hidden">◐</span>
      <span aria-hidden className="hidden dark:inline">☀</span>
    </button>
  );
}
