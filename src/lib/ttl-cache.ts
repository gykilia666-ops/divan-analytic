/**
 * Простой кеш одного значения на время жизни (CLAUDE.md §14.3: рейтинг — 60 секунд).
 * Живет в памяти экземпляра функции; одновременные промахи делят один запрос.
 * Ошибка загрузки не кешируется.
 */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now) {
  let value: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async get(load: () => Promise<T>): Promise<T> {
      if (value && now() - value.at < ttlMs) return value.data;
      if (inflight) return inflight;
      inflight = load()
        .then((data) => {
          value = { at: now(), data };
          return data;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    clear() {
      value = null;
    },
  };
}
