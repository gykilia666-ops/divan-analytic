import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { LEGAL_LINKS } from "@/lib/legal";
import { DELETE_CONFIRM_WORD } from "@/lib/pseudonym";
import { getMyConsents, type ConsentKind, type ConsentRow } from "@/server/account/consents";
import { getCurrentProfile, requireUser } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";

export const metadata: Metadata = { title: "Аккаунт" };
export const dynamic = "force-dynamic";

const CONSENT_LABELS: Record<ConsentKind, string> = {
  TERMS_AND_AGE: "Пользовательское соглашение и подтверждение 18+",
  PD_PROCESSING: "Обработка персональных данных",
};

async function loadConsents(): Promise<ConsentRow[] | null> {
  try {
    return await getMyConsents(await createClient());
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

export default async function AccountPage() {
  await requireUser("/my/account");
  // Профиля может не быть, если псевдоним еще не выбран (ADR-075): страница нужна, чтобы выйти из аккаунта.
  const profile = await getCurrentProfile();
  const displayName = profile?.displayName ?? null;
  const consents = await loadConsents();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Аккаунт</h1>
      {displayName ? (
        <p>
          Вы вошли через GitHub. Ваш псевдоним:{" "}
          <strong data-testid="account-name">{displayName}</strong>. Логин и аватар GitHub другим
          пользователям не показываются. Псевдоним выбирается один раз и не меняется; если его нужно
          изменить, напишите оператору (адрес в разделе «Приватность»).
        </p>
      ) : (
        <p data-testid="pseudonym-missing">
          Вы вошли через GitHub, но псевдоним ещё не выбран.{" "}
          <Link href="/my/pseudonym" className="underline underline-offset-4">
            Придумать псевдоним
          </Link>
          : без него нельзя делать прогнозы, личные страницы недоступны, а вас нет в рейтинге.
        </p>
      )}

      <section
        aria-labelledby="consents"
        className="space-y-3 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="consents" className="text-xl font-semibold">
          Согласия и документы
        </h2>
        {consents === null ? (
          <p role="alert">Не удалось загрузить согласия. Попробуйте позже.</p>
        ) : consents.length === 0 ? (
          <p data-testid="consents-empty">
            Записей о согласиях нет: они появятся при следующем входе.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-6" data-testid="consents-list">
            {consents.map((c) => (
              <li key={c.kind}>
                {CONSENT_LABELS[c.kind]}: <strong>{c.granted ? "дано" : "отозвано"}</strong> (
                {formatDate(c.createdAt)}, редакция {c.docVersion})
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          Документы:{" "}
          {LEGAL_LINKS.map((item, i) => (
            <span key={item.href}>
              {i > 0 ? ", " : ""}
              <Link href={item.href} className="underline underline-offset-2">
                {item.label}
              </Link>
            </span>
          ))}
          .
        </p>
      </section>

      <section
        aria-labelledby="delete"
        className="space-y-3 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="delete" className="text-xl font-semibold">
          Удалить аккаунт
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Учетная запись входа деактивируется: войти в этот аккаунт больше будет нельзя.</li>
          <li>
            Псевдоним заменяется на «Удалённый игрок», вы пропадаете из рейтинга, а действующие
            согласия фиксируются как отозванные.
          </li>
          <li>
            Записи о прогнозах и операциях с монетами остаются в обезличенном виде: они нужны для
            проверки расчетов и баланса.
          </li>
          <li>Отменить удаление нельзя. Повторный вход через GitHub создаст новый аккаунт.</li>
        </ul>
        <DeleteAccountForm
          confirmWord={displayName ?? DELETE_CONFIRM_WORD}
          named={Boolean(displayName)}
        />
      </section>
    </div>
  );
}
