"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/** Удаление аккаунта с подтверждением именем. После успеха — на главную, шапка перерисовывается без сессии. */
export function DeleteAccountForm({ confirmWord, named }: { confirmWord: string; named: boolean }) {
  const router = useRouter();
  const id = useId();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirm.trim() === confirmWord;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!matches) {
      setError("Введите слово точно так, как оно показано");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/me/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirm.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Не удалось удалить аккаунт");
        setPending(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Удаление аккаунта" className="space-y-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-confirm`}>
          Для подтверждения введите {named ? "ваш псевдоним" : "слово"}:{" "}
          <strong>{confirmWord}</strong>
        </label>
        <input
          id={`${id}-confirm`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          maxLength={100}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="max-w-sm rounded-lg border border-border bg-bg px-2 py-1"
        />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !matches}
        className="rounded-lg border border-border px-4 py-2 font-medium disabled:opacity-60"
      >
        {pending ? "Удаляем…" : "Удалить аккаунт навсегда"}
      </button>
    </form>
  );
}
