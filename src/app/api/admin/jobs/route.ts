import { AdminForbiddenError, getAdminDashboard } from "@/server/admin";
import { guardAdmin } from "@/server/admin/guard";
import { jsonError, jsonOk } from "@/server/http/response";

export const dynamic = "force-dynamic";

/** Диагностика заданий и очередь расчета (только администратор). */
export async function GET() {
  const requestId = crypto.randomUUID();
  const guard = await guardAdmin(requestId);
  if (!guard.ok) return guard.response;
  try {
    return jsonOk(await getAdminDashboard(guard.supabase, guard.env.SPORTS_PROVIDER), requestId);
  } catch (error) {
    if (error instanceof AdminForbiddenError) {
      return jsonError(403, "FORBIDDEN", "Недостаточно прав", requestId);
    }
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
