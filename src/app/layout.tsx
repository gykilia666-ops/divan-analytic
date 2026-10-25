import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ModeBanner } from "@/components/layout/mode-banner";
import { getPublicConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: { default: "Диванный аналитик", template: "%s — Диванный аналитик" },
  description:
    "Учебный симулятор спортивных прогнозов. Монеты не имеют денежной стоимости, коэффициенты демонстрационные.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { dataMode } = getPublicConfig();
  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          Перейти к содержимому
        </a>
        <ModeBanner mode={dataMode} />
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
