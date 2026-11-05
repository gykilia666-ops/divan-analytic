import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PseudonymForm } from "@/components/account/pseudonym-form";
import { safeNextPath } from "@/lib/safe-redirect";
import { getCurrentProfile, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Псевдоним" };
export const dynamic = "force-dynamic";

/**
 * Первый шаг после входа через GitHub: пользователь сам придумывает псевдоним (ADR-072). Выбор
 * одноразовый (ADR-073): если имя уже есть, страница отправляет дальше, смены нет.
 */
export default async function PseudonymPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  await requireUser(`/my/pseudonym?next=${encodeURIComponent(next)}`);
  const profile = await getCurrentProfile();
  // Профиля до выбора имени нет (ADR-075); с именем эта страница ничего не меняет.
  if (profile?.displayName) redirect(rawNext ? next : "/my/account");

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Придумайте псевдоним</h1>
      <p>
        Под этим именем вас увидят другие игроки в публичном рейтинге. Придумайте имя сами и не
        используйте настоящее имя, фамилию, логин GitHub и другие данные, по которым вас можно
        узнать.
      </p>
      <p>
        Имя, совпадающее с вашим логином или именем в GitHub, сайт не принимает. Псевдоним должен
        быть уникальным: если имя занято, выберите другое.
      </p>
      <p data-testid="pseudonym-once">
        <strong>Псевдоним выбирается один раз и потом не меняется.</strong> Подумайте перед
        сохранением.
      </p>
      <p data-testid="pseudonym-required">
        Пока псевдоним не выбран, прогнозы не принимаются, личные страницы (прогнозы, статистика,
        кошелёк) недоступны, а вас нет в рейтинге.
      </p>
      <PseudonymForm next={next === "/" ? "/matches" : next} />
    </div>
  );
}
