import type { Metadata } from "next";

export const metadata: Metadata = { title: "Приватность" };

export default function PrivacyPage() {
  return (
    <article className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Приватность</h1>
      <p className="rounded border border-border bg-surface p-3 text-sm">
        Черновик: текст будет дополнен при подключении авторизации.
      </p>
      <p>Сейчас приложение работает в демонстрационном режиме и не собирает данные пользователей.</p>
      <p>
        После подключения входа через GitHub будут храниться: идентификатор аккаунта, отображаемое имя,
        аватар из GitHub, виртуальный баланс, журнал операций и история прогнозов. В публичном рейтинге
        показываются только имя, аватар и итоговые агрегаты.
      </p>
    </article>
  );
}
