import type { DataMode } from "@/lib/env";

/**
 * Плашка режима показывается только в demo: там данные вымышленные и об этом нужно предупредить.
 * В рабочем режиме (connected) ее нет по решению владельца (ADR-063): режим виден в /admin, а задержка
 * данных честно указана на страницах матчей.
 */
export function ModeBanner({ mode }: { mode: DataMode }) {
  if (mode !== "demo") return null;
  return (
    <div
      role="status"
      data-testid="mode-banner"
      className="bg-warn-bg px-4 py-2 text-center text-sm font-medium text-warn-fg"
    >
      ДЕМО-РЕЖИМ: данные вымышленные, ничего не сохраняется на сервере.
    </div>
  );
}
