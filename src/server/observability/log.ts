/**
 * Структурированные события (docs/requirements.md §20.1, §13.6). Только безопасные поля: без токенов,
 * ключей, cookie, заголовков авторизации и email. Защита в глубину: даже если вызывающий код
 * передаст такое поле, значение будет заменено на [redacted]; длинные строки обрезаются.
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

const SENSITIVE_KEY =
  /(token|secret|password|passwd|authorization|cookie|api[-_]?key|apikey|service[-_]?role|email|jwt|bearer)/i;
const BEARER_VALUE = /\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const EMAIL_VALUE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_STRING = 300;
const MAX_DEPTH = 4;

function sanitizeString(value: string): string {
  const cleaned = value
    .replace(BEARER_VALUE, "$1[redacted]")
    .replace(JWT_VALUE, "[redacted-jwt]")
    .replace(EMAIL_VALUE, "[redacted-email]");
  return cleaned.length > MAX_STRING ? `${cleaned.slice(0, MAX_STRING)}…` : cleaned;
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeLogValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeLogValue(v, depth + 1);
  }
  return out;
}

export function logEvent({ level = "info", ...fields }: LogEvent): void {
  const safe = sanitizeLogValue(fields) as Record<string, unknown>;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
