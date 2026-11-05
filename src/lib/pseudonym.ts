/**
 * Правила псевдонима (ADR-072). Зеркало set_pseudonym() в БД: БД остается последней инстанцией
 * (занятость, совпадение с GitHub, зарезервированные слова), здесь — быстрая проверка до запроса.
 */
export const PSEUDONYM_MIN = 3;
export const PSEUDONYM_MAX = 24;

const PSEUDONYM_RE = /^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ._-]*$/;

export const PSEUDONYM_RULES =
  "От 3 до 24 символов: русские и латинские буквы, цифры, пробел, точка, дефис и нижнее подчёркивание. Начинаться имя должно с буквы или цифры.";

/** Подтверждение удаления аккаунта, пока псевдоним еще не выбран. */
export const DELETE_CONFIRM_WORD = "удалить";

/** Коды ответа set_pseudonym() и тексты для пользователя. */
export const PSEUDONYM_ERROR_MESSAGES = {
  INVALID_NAME: PSEUDONYM_RULES,
  RESERVED_NAME: "Это слово зарезервировано, выберите другое имя.",
  MATCHES_ACCOUNT:
    "Псевдоним не должен совпадать с логином или именем в GitHub: по нему вас смогут найти.",
  NAME_TAKEN: "Такой псевдоним уже занят, выберите другой.",
  RATE_LIMITED: "Слишком часто, повторите через минуту.",
  ACCOUNT_NOT_FOUND: "Аккаунт не готов: выйдите и войдите снова.",
  ACCOUNT_DISABLED: "Аккаунт отключён.",
  ALREADY_SET: "Псевдоним выбирается один раз и не меняется.",
} as const;

export type PseudonymErrorCode = keyof typeof PSEUDONYM_ERROR_MESSAGES;

/** Пробелы по краям убираются, повторные схлопываются (как в БД). */
export function normalizePseudonym(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export type PseudonymCheck = { ok: true; name: string } | { ok: false; message: string };

export function checkPseudonym(raw: string): PseudonymCheck {
  const name = normalizePseudonym(raw);
  if (name.length < PSEUDONYM_MIN || name.length > PSEUDONYM_MAX || !PSEUDONYM_RE.test(name)) {
    return { ok: false, message: PSEUDONYM_RULES };
  }
  return { ok: true, name };
}
