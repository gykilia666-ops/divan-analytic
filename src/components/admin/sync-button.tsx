"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; status: string }
  | { kind: "error"; message: string };

/** Ручной запуск синхронизации. Результат объявляется для скринридеров (aria-live). */
export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    setState({ kind: "pending" });
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: { message?: unknown } }).error.message ?? "Ошибка")
            : "Ошибка запуска";
        setState({ kind: "error", message });
        return;
      }
      const status =
        typeof body === "object" && body !== null && "data" in body
          ? String((body as { data: { status?: unknown } }).data.status ?? "OK")
          : "OK";
      setState({ kind: "done", status });
      router.refresh();
    } catch {
      setState({ kind: "error", message: "Сеть недоступна" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state.kind === "pending"}
        className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg disabled:opacity-60"
      >
        {state.kind === "pending" ? "Выполняется…" : "Запустить синхронизацию"}
      </button>
      <p aria-live="polite" data-testid="admin-sync-result" className="text-sm">
        {state.kind === "done" ? `Готово: ${state.status}` : null}
        {state.kind === "error" ? state.message : null}
      </p>
    </div>
  );
}
