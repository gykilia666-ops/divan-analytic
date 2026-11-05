import type { Metadata, Viewport } from "next";
import { Russo_One } from "next/font/google";
import { cookies } from "next/headers";
import { connection } from "next/server";
import "./globals.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ModeBanner } from "@/components/layout/mode-banner";
import { ParallaxBackground } from "@/components/layout/parallax-background";
import { getPublicConfig } from "@/lib/env";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// Шрифт логотипа: спортивный, с кириллицей. next/font скачивает его при сборке и отдает с нашего домена
// (CSP font-src 'self', без запросов к Google из браузера).
const logoFont = Russo_One({
  weight: "400",
  subsets: ["cyrillic", "latin"],
  display: "swap",
  variable: "--font-logo",
});

export const metadata: Metadata = {
  title: { default: "Диванный аналитик", template: "%s — Диванный аналитик" },
  description:
    "Учебный симулятор спортивных прогнозов. Монеты не имеют денежной стоимости, коэффициенты демонстрационные.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// CSP с nonce (src/proxy.ts) требует динамического рендеринга: nonce свой у каждого ответа,
// поэтому статическая предварительная отрисовка отключена для всех страниц (ADR-056).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const { dataMode } = getPublicConfig();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="ru" data-theme={theme ?? undefined} className={logoFont.variable}>
      <body className="min-h-screen flex flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          Перейти к содержимому
        </a>
        <ParallaxBackground />
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
