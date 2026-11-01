import type { Metadata } from "next";
import { DISCLAIMER } from "@/components/layout/site-footer";

export const metadata: Metadata = { title: "Правила" };

export default function RulesPage() {
  return (
    <article className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Правила</h1>
      <p className="rounded border border-border bg-surface p-3 text-sm">
        Прогнозы пока не включены: приложение в разработке. Ниже — правила, по которым они будут
        работать.
      </p>
      <p>{DISCLAIMER}</p>
      <ul className="list-disc space-y-2 pl-6">
        <li>Новый пользователь однократно получает 10 000 виртуальных монет.</li>
        <li>
          Прогноз — один исход одного матча: победа хозяев, ничья или победа гостей (основное
          время).
        </li>
        <li>Сумма — целое число от 10 до 1 000 монет, не больше баланса.</li>
        <li>На один матч — один прогноз. Отменить принятый прогноз нельзя.</li>
        <li>Прием прогнозов закрывается за 5 минут до начала матча.</li>
        <li>Если данные поставщика старше 60 минут, новые прогнозы не принимаются.</li>
        <li>
          Потенциальная выплата = сумма × коэффициент (округление вниз) и включает поставленную
          сумму.
        </li>
        <li>Если матч отменён, сумма возвращается.</li>
        <li>Монеты нельзя купить, продать или вывести.</li>
      </ul>
    </article>
  );
}
