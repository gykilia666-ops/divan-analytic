import { getCurrentProfile, getCurrentUser } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http/response";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);

    const profile = await getCurrentProfile();
    // До выбора псевдонима профиля нет (ADR-075): отвечаем без имени, а не ошибкой.
    return jsonOk(
      {
        id: user.id,
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      requestId,
    );
  } catch {
    // Детали (SQL, стек, ключи) клиенту не отдаются.
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
