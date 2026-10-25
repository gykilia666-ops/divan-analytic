"use client";

import { useSyncExternalStore } from "react";
import { formatKickoff } from "@/lib/time";

const subscribe = () => () => {};
const getBrowserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
// На сервере и при гидратации используется UTC — разметка совпадает без hydration mismatch;
// затем React переключается на зону браузера. Зона всегда указана в тексте.
const getServerZone = () => "UTC";

export function KickoffTime({ iso }: { iso: string }) {
  const zone = useSyncExternalStore(subscribe, getBrowserZone, getServerZone);
  return <time dateTime={iso}>{formatKickoff(iso, zone)}</time>;
}
