import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Вход" };

const ERRORS: Record<string, string> = {
  oauth: "Не удалось войти через GitHub. Попробуйте ещё раз.",
  denied: "Вход отменён.",
  disabled: "Этот аккаунт отключён.",
  init: "Не удалось подготовить аккаунт. Попробуйте позже.",
};

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
      <div className="max-w-xl space-y-3">
        <h1 className="text-2xl font-bold">Вход</h1>
        <p data-testid="login-unavailable">
          Вход недоступен в демо-режиме: здесь нет аккаунтов и ничего не сохраняется на сервере.
        </p>
      </div>
    );
  }

  if (await getCurrentUser()) redirect(next);

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Вход</h1>
      {errorText ? (
        <p role="alert" className="rounded border border-border bg-warn-bg p-3 text-warn-fg">
          {errorText}
        </p>
      ) : null}
      <p>
        Войдите через GitHub, чтобы получить 10 000 виртуальных монет. Монеты не имеют денежной
        стоимости.
      </p>
      <form action="/auth/login" method="post">
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="rounded bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90"
        >
          Войти через GitHub
        </button>
      </form>
    </div>
  );
}
