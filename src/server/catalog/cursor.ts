/** Курсор пагинации: стабильная пара (kickoff_at, id), закодированная в base64url. */

const UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

export interface CursorValue {
  kickoffAt: string;
  id: string;
}

export function encodeCursor(value: CursorValue): string {
  return Buffer.from(`${value.kickoffAt}|${value.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): CursorValue | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [kickoffAt, id, extra] = text.split("|");
  if (!kickoffAt || !id || extra !== undefined) return null;
  const t = Date.parse(kickoffAt);
  if (Number.isNaN(t) || new Date(t).toISOString() !== kickoffAt) return null;
  if (!UUIDISH.test(id)) return null;
  return { kickoffAt, id };
}
