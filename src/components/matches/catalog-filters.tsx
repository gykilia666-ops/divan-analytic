import type { CatalogQuery } from "@/server/catalog/types";
import { TimezoneSelect } from "./timezone-select";

const SCOPE_LABEL = { all: "Все", upcoming: "Предстоящие", finished: "Завершённые" } as const;

/** Обычная GET-форма: работает без JavaScript, состояние фильтров — в адресе страницы. */
export function CatalogFilters({
  query,
  competitions,
  explicitTimeZone,
}: {
  query: CatalogQuery;
  competitions: { code: string; name: string }[];
  explicitTimeZone: string | null;
}) {
  const field = "flex flex-col gap-1 text-sm";
  const control = "w-full rounded border border-border bg-surface px-2 py-1";
  return (
    <form
      method="get"
      action="/matches"
      className="grid gap-3 rounded border border-border bg-surface p-3 sm:grid-cols-5"
      aria-label="Фильтры матчей"
    >
      <label className={field}>
        Соревнование
        <select name="competition" defaultValue={query.competition ?? ""} className={control}>
          <option value="">Все</option>
          {competitions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Матчи
        <select name="scope" defaultValue={query.scope} className={control}>
          {Object.entries(SCOPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Дата
        <input type="date" name="date" defaultValue={query.date ?? ""} className={control} />
      </label>
      <div className={field}>
        <label htmlFor="filter-tz">Часовой пояс</label>
        <TimezoneSelect selected={explicitTimeZone} />
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          className="w-full rounded bg-accent px-4 py-1.5 font-medium text-accent-fg hover:opacity-90"
        >
          Показать
        </button>
      </div>
    </form>
  );
}
