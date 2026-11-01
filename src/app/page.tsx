import Link from "next/link";
import { DISCLAIMER } from "@/components/layout/site-footer";

const STEPS = [
  "Смотришь матчи.",
  "Входишь через GitHub и получаешь 10 000 виртуальных монет.",
  "Выбираешь исход: победа хозяев, ничья или победа гостей.",
  "После матча прогноз рассчитывается, а рейтинг обновляется.",
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold sm:text-4xl">Диванный аналитик</h1>
        <p className="max-w-2xl text-lg text-muted">
          Учебный симулятор прогнозов на футбол: виртуальные монеты, демонстрационные коэффициенты и
          честный расчёт. Аналитика уровня «смотрел обзор».
        </p>
        <p className="max-w-2xl rounded border border-border bg-surface p-3 text-sm">
          {DISCLAIMER}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/matches"
            className="rounded bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90"
          >
            Посмотреть матчи
          </Link>
          {/* CTA «Попробовать демо» появится вместе с купоном (этап 6): сейчас ставок в приложении нет. */}
          <Link
            href="/rules"
            className="rounded border border-border bg-surface px-4 py-2 font-medium hover:bg-bg"
          >
            Как это работает
          </Link>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-3 text-xl font-semibold">
          Как это устроено
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted">
          Статус разработки: сейчас доступен каркас и демонстрационный список матчей. Прогнозы, вход
          и рейтинг включаются по этапам.
        </p>
      </section>
    </div>
  );
}
