import { getEnv } from "@/lib/env";

export { LEGAL_VERSION, LEGAL_VERSION_LABEL } from "@/lib/legal-version";

/** Юридические документы сайта (порядок — как в подвале и на форме входа). */
export const LEGAL_LINKS = [
  { href: "/terms", label: "Пользовательское соглашение" },
  { href: "/privacy", label: "Политика обработки персональных данных" },
  { href: "/consent", label: "Согласие на обработку персональных данных" },
] as const;

/**
 * Лица, которым передаются данные (Политика, Согласие). Поменялся поставщик или регион — обновить
 * здесь, поднять LEGAL_VERSION и пройти docs/legal-checklist.md.
 */
export const PROCESSORS = [
  {
    name: "Supabase (Supabase, Inc.)",
    role: "база данных и аутентификация",
    place: "серверы в Лондоне, Великобритания",
  },
  {
    name: "Vercel (Vercel Inc., США)",
    role: "хостинг приложения, технические журналы запросов",
    place: "функции приложения выполняются в Лондоне, Великобритания",
  },
  {
    name: "GitHub (GitHub, Inc., США)",
    role: "подтверждение входа (OAuth)",
    place: "США",
  },
] as const;

export interface OperatorInfo {
  name: string | null;
  email: string | null;
  /** Заданы имя и почта, а почта похожа на адрес электронной почты. */
  complete: boolean;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function clean(value: string | undefined): string | null {
  const text = value?.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Чистая функция: данные оператора из значений окружения. */
export function resolveOperator(source: { name?: string; email?: string }): OperatorInfo {
  const name = clean(source.name);
  const rawEmail = clean(source.email);
  const email = rawEmail !== null && EMAIL_RE.test(rawEmail) ? rawEmail : null;
  return { name, email, complete: name !== null && email !== null };
}

/**
 * Оператор персональных данных = владелец сайта. ФИО и почта берутся из окружения
 * (LEGAL_OPERATOR_*), а не из репозитория. Пока данные не заданы, вход в connected-режиме закрыт
 * (src/app/auth/login/route.ts): нельзя собирать персональные данные без указания оператора.
 */
export function getOperator(): OperatorInfo {
  const env = getEnv();
  return resolveOperator({
    name: env.LEGAL_OPERATOR_NAME,
    email: env.LEGAL_OPERATOR_EMAIL,
  });
}

/** Адрес сайта для текстов документов; null — не задан (demo). */
export function getSiteUrl(): string | null {
  return getEnv().APP_ORIGIN ?? null;
}
