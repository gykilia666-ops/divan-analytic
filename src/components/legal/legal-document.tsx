import type { ReactNode } from "react";
import { getOperator, LEGAL_VERSION_LABEL } from "@/lib/legal";

/** Каркас юридического документа: заголовок, редакция, читаемая ширина. */
export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="max-w-3xl space-y-6 leading-relaxed">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted">Редакция от {LEGAL_VERSION_LABEL}</p>
      </header>
      {children}
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Данные оператора из окружения. Пустые поля показываются явно, а не скрываются. */
export function OperatorBlock() {
  const operator = getOperator();
  const missing = "не указано";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
        <dt className="font-medium">Оператор (владелец сайта)</dt>
        <dd data-testid="operator-name">{operator.name ?? missing}</dd>
        <dt className="font-medium">Электронная почта для обращений</dt>
        <dd data-testid="operator-email">{operator.email ?? missing}</dd>
      </dl>
      {operator.complete ? null : (
        <p role="note" data-testid="operator-incomplete">
          Данные оператора пока не заданы (демонстрационный режим или не настроено окружение). В
          рабочей версии вход закрыт, пока они не указаны.
        </p>
      )}
    </div>
  );
}

/** Ссылка на документ, открывающаяся в новой вкладке (форма входа не теряет введенное). */
export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {children}
      <span className="sr-only"> (откроется в новой вкладке)</span>
    </a>
  );
}
