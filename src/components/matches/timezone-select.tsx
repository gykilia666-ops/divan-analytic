"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getBrowserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerZone = () => "";

const COMMON_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Moscow",
  "Asia/Novosibirsk",
  "Asia/Krasnoyarsk",
];

/**
 * Выбор часового пояса. Без явного выбора подставляется зона браузера: ключ заставляет
 * select смонтироваться заново после гидратации, когда зона браузера становится известна.
 */
export function TimezoneSelect({ selected }: { selected: string | null }) {
  const browserZone = useSyncExternalStore(subscribe, getBrowserZone, getServerZone);
  const zones = [...new Set([selected, browserZone, ...COMMON_ZONES].filter(Boolean))] as string[];
  const value = selected ?? (browserZone || "UTC");
  return (
    <select
      key={value}
      id="filter-tz"
      name="tz"
      defaultValue={value}
      className="w-full rounded-lg border border-border bg-surface px-2 py-1"
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone === browserZone ? `${zone} (браузер)` : zone}
        </option>
      ))}
    </select>
  );
}
