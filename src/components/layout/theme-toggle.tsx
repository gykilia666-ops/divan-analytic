"use client";

import { useSyncExternalStore } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

const CHANGE_EVENT = "divan:theme-change";

function effectiveTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * Переключатель «День / Ночь». Выбор сохраняется на год в cookie (не секрет; сервер по ней сразу
 * рисует нужную тему). Без выбора действует системная тема. `initial` — явный выбор из cookie для
 * серверной отрисовки; после гидратации берется фактическая тема.
 */
export function ThemeToggle({ initial }: { initial: Theme | null }) {
  const theme = useSyncExternalStore(subscribe, effectiveTheme, () => initial ?? "light");

  function toggle() {
    const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  const isDark = theme === "dark";
  // Доступное имя обязано содержать видимый текст кнопки («День» / «Ночь») — WCAG 2.5.3, правило axe
  // label-content-name-mismatch.
  const label = isDark ? "Включить тему «День»" : "Включить тему «Ночь»";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm"
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      <span>{isDark ? "День" : "Ночь"}</span>
    </button>
  );
}
