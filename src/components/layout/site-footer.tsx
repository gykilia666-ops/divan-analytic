export const DISCLAIMER =
  "Учебный симулятор. Монеты не имеют денежной стоимости. Коэффициенты демонстрационные. Спортивные данные могут поступать с задержкой.";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 text-sm text-muted">
        <p data-testid="disclaimer">{DISCLAIMER}</p>
        <p className="mt-1">Монеты ненастоящие. Уверенность — настоящая.</p>
      </div>
    </footer>
  );
}
