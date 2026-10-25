"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
      <p>Прогноз не зашёл. Футбол виноват — но на самом деле ошибка у нас. Попробуйте ещё раз.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90"
      >
        Повторить
      </button>
    </div>
  );
}
