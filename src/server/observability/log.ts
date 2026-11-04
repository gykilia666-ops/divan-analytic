/**
 * Структурированные события (CLAUDE.md §20.1). Только безопасные поля: без токенов,
 * ключей, email и текстов SQL.
 */
export interface LogEvent {
  event: string;
  level?: "info" | "warn" | "error";
  requestId?: string;
  jobId?: string;
  durationMs?: number;
  providerStatus?: string;
  processedCount?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export function logEvent({ level = "info", ...fields }: LogEvent): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
