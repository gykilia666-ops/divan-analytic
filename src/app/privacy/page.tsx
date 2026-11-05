import type { Metadata } from "next";
import { getPublicConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Приватность" };

export default function PrivacyPage() {
  const { dataMode } = getPublicConfig();

  return (
    <article className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Приватность</h1>

      {dataMode === "demo" ? (
        <p className="rounded border border-border bg-surface p-3 text-sm">
          Сейчас открыт демонстрационный режим: вход отключен, прогнозы не сохраняются, данные о вас
          не собираются. Ниже описано, что хранится в рабочей версии после входа.
        </p>
      ) : null}

      <section aria-labelledby="what" className="space-y-2">
        <h2 id="what" className="text-xl font-semibold">
          Что хранится
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Учетная запись.</strong> При входе через GitHub сервис аутентификации сохраняет
            идентификатор аккаунта GitHub, логин, ссылку на аватар и адрес электронной почты,
            который передает GitHub. Почта нигде не показывается и не используется для рассылок.
          </li>
          <li>
            <strong>Профиль.</strong> Отображаемое имя (логин GitHub) и ссылка на аватар.
          </li>
          <li>
            <strong>Игровые данные.</strong> Виртуальный баланс, журнал операций с монетами и
            история прогнозов. Монеты не имеют денежной стоимости.
          </li>
          <li>
            <strong>Служебные записи.</strong> Счетчики частоты запросов (удаляются через сутки),
            журнал запусков синхронизации (30 дней, без персональных данных), записи аудита действий
            администратора.
          </li>
        </ul>
        <p>
          Пароли не хранятся: вход выполняет GitHub. Токены доступа к GitHub приложение не
          сохраняет. Технические логи сервера не содержат почту, токены и cookie.
        </p>
      </section>

      <section aria-labelledby="public" className="space-y-2">
        <h2 id="public" className="text-xl font-semibold">
          Что видно другим
        </h2>
        <p>
          Только публичный рейтинг — и только после пяти рассчитанных прогнозов: имя, аватар и
          итоговые числа (количество прогнозов, доля угаданных, ROI, результат). Баланс, журнал,
          отдельные прогнозы и почта другим пользователям недоступны — это проверяется правилами
          доступа в базе данных.
        </p>
      </section>

      <section aria-labelledby="cookies" className="space-y-2">
        <h2 id="cookies" className="text-xl font-semibold">
          Cookie
        </h2>
        <p>
          Используются только cookie сессии входа и короткоживущая cookie с адресом возврата после
          входа (10 минут). Аналитики, рекламы и сторонних трекеров нет.
        </p>
      </section>

      <section aria-labelledby="where" className="space-y-2">
        <h2 id="where" className="text-xl font-semibold">
          Где обрабатываются данные
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Supabase — база данных и вход, сервер в Лондоне (Великобритания).</li>
          <li>Vercel — хостинг приложения, функции в Лондоне.</li>
          <li>GitHub — подтверждение входа.</li>
        </ul>
        <p>
          Поставщик спортивных данных football-data.org никаких данных о пользователях не получает.
        </p>
      </section>

      <section aria-labelledby="delete" className="space-y-2">
        <h2 id="delete" className="text-xl font-semibold">
          Удаление
        </h2>
        <p>
          Данные хранятся, пока существует аккаунт. Удалить аккаунт можно самостоятельно на странице
          «Аккаунт» (ссылка — ваше имя в шапке сайта): учетная запись входа удаляется, имя и аватар
          обезличиваются, вы пропадаете из рейтинга. Записи о прогнозах и операциях с монетами
          остаются в обезличенном виде — по ним проверяются расчеты и баланс. Отозвать доступ
          приложения к GitHub можно в GitHub → Settings → Applications → Authorized OAuth Apps.
        </p>
      </section>

      <p className="text-sm text-muted">
        Это учебный проект; документ обновлен 5 ноября 2026 года.
      </p>
    </article>
  );
}
