/**
 * Content-Security-Policy (CLAUDE.md §13.4), подогнанная под Next.js App Router и вход через GitHub:
 * - скрипты только с nonce текущего запроса ('strict-dynamic' разрешает чанки, загружаемые ими);
 * - стили inline разрешены: Next.js и React вставляют style-атрибуты, а внешних стилей нет;
 * - form-action включает Supabase Auth и GitHub: браузер проверяет цепочку редиректов после POST /auth/login;
 * - встраивание сайта в чужие фреймы запрещено.
 * В dev добавляется 'unsafe-eval' и websocket для горячей перезагрузки — только в dev.
 */
export interface CspOptions {
  nonce: string;
  dev: boolean;
  /** Origin Supabase (для формы входа); null в demo. */
  supabaseUrl: string | null;
  /** https-сайт: добавляется upgrade-insecure-requests. */
  https: boolean;
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, dev, supabaseUrl, https }: CspOptions): string {
  const supabase = originOf(supabaseUrl);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(dev ? ["ws:", "wss:"] : [])]],
    ["form-action", ["'self'", ...(supabase ? [supabase] : []), "https://github.com"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Случайный nonce (128 бит) в base64. Работает в Edge и Node runtime. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
