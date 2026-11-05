import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginConsentForm } from "@/components/auth/login-consent-form";
import { getEnv } from "@/lib/env";
import { getOperator } from "@/lib/legal";
import { safeNextPath } from "@/lib/safe-redirect";
import { getCurrentProfile, getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Вход" };

const ERRORS: Record<string, string> = {
  oauth: "Не удалось войти через GitHub. Попробуйте ещё раз.",
  denied: "Вход отменён.",
  disabled: "Этот аккаунт отключён.",
  init: "Не удалось подготовить аккаунт. Попробуйте позже.",
  consent: "Страница входа устарела: откройте её заново и повторите вход.",
};

async function loadUser() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

async function loadProfile() {
  try {
    return await getCurrentProfile();
  } catch {
    return null;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNextPath(rawNext);
  // Сообщение берется только из белого списка: произвольный текст из URL не выводится.
  const errorText = error ? ERRORS[error] : undefined;

  if (getEnv().APP_DATA_MODE !== "connected") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center py-8">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-surface/85 p-6 text-center shadow-xl backdrop-blur-md sm:p-8">
          <h1 className="text-2xl font-bold">Вход</h1>
          <p data-testid="login-unavailable">
            Вход недоступен в демо-режиме: здесь нет аккаунтов и ничего не сохраняется на сервере.
          </p>
        </div>
      </div>
    );
  }

  // Уже вошедшего ведем дальше: с псевдонимом — на страницу возврата, без него (профиля еще нет,
  // ADR-075) — на выбор псевдонима. Устаревшую сессию удаленного пользователя БД не пустит дальше.
  if (await loadUser()) {
    if ((await loadProfile())?.displayName) redirect(next);
    redirect(`/my/pseudonym?next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-8">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-surface/85 p-6 text-center shadow-xl backdrop-blur-md sm:p-8">
        <div
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-3xl text-accent-fg"
        >
          ⚽
        </div>
        <h1 className="text-2xl font-bold">Вход</h1>
        {errorText ? (
          <p
            role="alert"
            className="rounded-lg border border-border bg-warn-bg p-3 text-left text-warn-fg"
          >
            {errorText}
          </p>
        ) : null}
        <p>
          Войдите через GitHub и придумайте псевдоним, чтобы получить 10 000 виртуальных монет.
          Монеты не имеют денежной стоимости.
        </p>
        {getOperator().complete ? (
          <LoginConsentForm next={next} />
        ) : (
          <p role="alert" data-testid="login-operator-missing">
            Вход временно недоступен: не указаны данные оператора сайта (владелец и почта для
            обращений). Без них нельзя собирать персональные данные.
          </p>
        )}
      </div>
    </div>
  );
}
