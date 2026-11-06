/**
 * Безопасный адрес возврата после входа (docs/requirements.md §6.2, §13.4): только внутренний путь
 * из белого списка корней. Всё остальное заменяется на «/».
 */
const INTERNAL_BASE = "http://internal.invalid";
const ALLOWED_ROOTS = ["/matches", "/rules", "/privacy", "/leaderboard", "/my", "/admin"] as const;
const MAX_LENGTH = 200;

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_LENGTH) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (hasControlChars(raw)) return "/";

  let url: URL;
  try {
    url = new URL(raw, INTERNAL_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== INTERNAL_BASE) return "/";

  const { pathname, search } = url;
  if (pathname === "/") return `/${search}`;
  const allowed = ALLOWED_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  return allowed ? `${pathname}${search}` : "/";
}
