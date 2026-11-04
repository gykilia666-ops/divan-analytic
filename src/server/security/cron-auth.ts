import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Машинная аутентификация внутренних заданий: заголовок `Authorization: Bearer <CRON_SECRET>`.
 * Сравнение по хешам постоянной длины (timingSafeEqual), чтобы не раскрывать секрет по времени.
 */
export function isAuthorizedCron(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !authorizationHeader) return false;
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
  if (!match?.[1]) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
