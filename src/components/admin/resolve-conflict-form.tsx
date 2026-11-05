"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/** Принять наблюдаемый итог матча и снять паузу автоматики. Причина обязательна. */
export function ResolveConflictForm({ matchId }: { matchId: string }) {
  const router = useRouter();
  const id = useId();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (note.trim().length < 5) {
      setError("Укажите причину (от 5 символов)");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, note: note.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Не удалось снять паузу");
        return;
      }
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 flex flex-wrap items-end gap-2"
      aria-label="Принять итог"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={`${id}-note`} className="text-sm">
          Причина (попадет в аудит)
        </label>
        <input
          id={`${id}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="rounded border border-border bg-bg px-2 py-1"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-3 py-1 disabled:opacity-60"
      >
        Принять итог
      </button>
      {error ? (
        <p id={`${id}-error`} role="alert" className="w-full text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
