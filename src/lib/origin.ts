/**
 * Same-origin проверка для браузерных команд (POST), CLAUDE.md §13.4.
 * Заголовок Origin обязателен: его отсутствие или значение "null" считается отказом.
 */
export function isAllowedOrigin(
  originHeader: string | null,
  appOrigin: string | undefined,
): boolean {
  if (!originHeader || !appOrigin) return false;
  try {
    return new URL(originHeader).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}
