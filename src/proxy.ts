import type { NextRequest } from "next/server";
import { updateSession } from "@/server/auth/update-session";

// Next.js 16: файл proxy.ts заменил middleware.ts. Это НЕ единственная авторизация:
// страницы и API проверяют пользователя сами (src/server/auth/session.ts).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
