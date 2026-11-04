"use client";

import { useSyncExternalStore } from "react";
import { formatKickoff } from "@/lib/time";

const subscribe = () => () => {};
const getBrowserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
// На сервере и при гидратации используется UTC — разметка совпадает без hydration mismatch;
// затем React переключается на зону браузера. Зона всегда указана в тексте.
const getServerZone = () => "UTC";

/** Время с явной зоной. Если зона выбрана пользователем — используется она, иначе зона браузера. */
export function KickoffTime({ iso, timeZone }: { iso: string; timeZone?: string | null }) {
  const browserZone = useSyncExternalStore(subscribe, getBrowserZone, getServerZone);
  const zone = timeZone ?? browserZone;
  return <time dateTime={iso}>{formatKickoff(iso, zone)}</time>;
}
