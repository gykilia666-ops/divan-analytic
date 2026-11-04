import { getCurrentProfile, getCurrentUser } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http/response";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);

    const profile = await getCurrentProfile();
    if (!profile) return jsonError(404, "NOT_FOUND", "Профиль не найден", requestId);
    return jsonOk(
      { id: profile.id, displayName: profile.displayName, avatarUrl: profile.avatarUrl },
      requestId,
    );
  } catch {
    // Детали (SQL, стек, ключи) клиенту не отдаются.
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
