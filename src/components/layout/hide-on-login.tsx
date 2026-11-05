"use client";

import { usePathname } from "next/navigation";

/**
 * Прячет вложенный блок на странице входа: там те же документы уже указаны в подписи под кнопкой,
 * и дублировать их в подвале незачем (ADR-077). На остальных страницах блок виден.
 */
export function HideOnLogin({ children }: { children: React.ReactNode }) {
  return usePathname() === "/login" ? null : children;
}
