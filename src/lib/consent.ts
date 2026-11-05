import { LEGAL_VERSION } from "./legal-version";

/**
 * Согласия при входе (ADR-065, ADR-076, ADR-077). Отдельных отметок нет: под кнопкой «Войти через
 * GitHub» стоит подпись «нажимая, вы подтверждаете, что вам 18+, и принимаете Соглашение и даёте
 * согласие на обработку персональных данных» со ссылками на документы. Нажатие и есть согласие;
 * доказательство — запись в журнале `user_consents` (два вида, версия документов, время).
 */

/**
 * Значение короткоживущей cookie, которая переносит факт согласия с формы входа в auth-callback:
 * версия документов. Версия обязана совпадать с текущей: форма, открытая до обновления документов,
 * не засчитывается.
 */
export function serializeConsentCookie(version: string = LEGAL_VERSION): string {
  return version;
}

export function parseConsentCookie(
  raw: string | null | undefined,
  version: string = LEGAL_VERSION,
): boolean {
  return raw === version;
}
