import Link from "next/link";
import { LEADERBOARD_MIN_SETTLED } from "@/domain/stats/stats";

const FEATURES = [
  {
    title: "Разбирай матчи",
    text: "Смотри расписание и результаты, сравнивай команды и составляй своё мнение о каждой игре.",
  },
  {
    title: "Делай прогнозы",
    text: "Выбирай исход: победа хозяев, ничья или победа гостей. Ставишь виртуальные монеты, настоящие деньги не нужны.",
  },
  {
    title: "Докажи, что ты эксперт",
    text: `Прогнозы честно рассчитываются после матча. После ${LEADERBOARD_MIN_SETTLED} рассчитанных прогнозов ты попадаешь в рейтинг аналитиков под своим псевдонимом.`,
  },
];

const STEPS = [
  "Войди через GitHub и придумай псевдоним: получишь 10 000 виртуальных монет.",
  "Выбери матч и сделай прогноз.",
  "После финального свистка прогноз рассчитывается, а твоя статистика и место в рейтинге обновляются.",
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold sm:text-4xl">Ну ты то точно разбираешься!</h1>
        <p className="max-w-2xl text-lg">
          Приложение, чтобы почувствовать себя экспертом по футболу: разбирай матчи, делай прогнозы
          и смотри, насколько твоя интуиция сильнее чужой.
        </p>
        <p className="max-w-2xl text-muted">
          Это учебный симулятор: монеты виртуальные и не имеют денежной стоимости.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/matches"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90"
          >
            Посмотреть матчи
          </Link>
          <Link
            href="/leaderboard"
            className="rounded-lg border border-border bg-surface px-4 py-2 font-medium hover:bg-bg"
          >
            Рейтинг аналитиков
          </Link>
          <Link
            href="/rules"
            className="rounded-lg border border-border bg-surface px-4 py-2 font-medium hover:bg-bg"
          >
            Как это работает
          </Link>
        </div>
      </section>

      <section aria-labelledby="features">
        <h2 id="features" className="sr-only">
          Что здесь можно делать
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl border border-border bg-surface/85 p-4">
              <h3 className="mb-1 font-semibold">{f.title}</h3>
              <p className="text-sm text-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-3 text-xl font-semibold">
          Как начать
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
