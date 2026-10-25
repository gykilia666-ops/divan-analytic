import type { DataMode } from "@/lib/env";

export function ModeBanner({ mode }: { mode: DataMode }) {
  const text =
    mode === "demo"
      ? "ДЕМО-РЕЖИМ: данные вымышленные, ничего не сохраняется на сервере."
      : "Режим connected: реальные матчи поставщика, возможна задержка данных.";
  return (
    <div
      role="status"
      data-testid="mode-banner"
      className="bg-warn-bg px-4 py-2 text-center text-sm font-medium text-warn-fg"
    >
      {text}
    </div>
  );
}
