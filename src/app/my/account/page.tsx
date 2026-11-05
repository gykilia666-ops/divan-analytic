import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { getCurrentProfile, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Аккаунт" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  await requireUser("/my/account");
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=%2Fmy%2Faccount");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Аккаунт</h1>
      <p>
        Вы вошли через GitHub как <strong data-testid="account-name">{profile.displayName}</strong>.
      </p>

      <section
        aria-labelledby="delete"
        className="space-y-3 rounded border border-border bg-surface p-4"
      >
        <h2 id="delete" className="text-xl font-semibold">
          Удалить аккаунт
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>Учетная запись входа удаляется: войти в этот аккаунт больше будет нельзя.</li>
          <li>Имя и аватар обезличиваются, вы пропадаете из рейтинга.</li>
          <li>
            Записи о прогнозах и операциях с монетами остаются в обезличенном виде: они нужны для
            проверки расчетов и баланса.
          </li>
          <li>Отменить удаление нельзя. Повторный вход через GitHub создаст новый аккаунт.</li>
        </ul>
        <DeleteAccountForm displayName={profile.displayName} />
      </section>
    </div>
  );
}
