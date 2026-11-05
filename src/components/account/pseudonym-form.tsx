"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { checkPseudonym, PSEUDONYM_MAX, PSEUDONYM_RULES } from "@/lib/pseudonym";

/** Однократный выбор псевдонима. Имя проверяет БД; здесь — быстрая проверка формата и показ причины отказа. */
export function PseudonymForm({ next }: { next: string }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const check = checkPseudonym(name);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/me/pseudonym", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: check.name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Не удалось сохранить псевдоним");
        setPending(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Сеть недоступна");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Выбор псевдонима" className="space-y-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className="font-medium">
          Псевдоним
        </label>
        <input
          id={`${id}-name`}
          name="pseudonym"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={PSEUDONYM_MAX + 10}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-rules${error ? ` ${id}-error` : ""}`}
          className="max-w-sm rounded-lg border border-border bg-bg px-2 py-1"
        />
        <p id={`${id}-rules`} className="text-sm text-muted">
          {PSEUDONYM_RULES}
        </p>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Сохраняем…" : "Выбрать псевдоним"}
      </button>
    </form>
  );
}
