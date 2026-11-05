/** Цветовая тема (День/Ночь). Выбор хранится в cookie, чтобы сервер сразу отрисовал нужную тему без
 *  мигания и без встроенного скрипта (CSP запрещает inline-скрипты без nonce). Без выбора — как в системе. */
export const THEME_COOKIE = "theme";
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}
