import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/server/catalog/cursor";
import { catalogSearch, parseCatalogQuery } from "@/server/catalog/parse-query";

describe("cursor", () => {
  it("кодирование туда и обратно", () => {
    const c = { kickoffAt: "2026-11-06T20:00:00.000Z", id: "0b6f2f0e-1111-4222-8333-944444444444" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("мусор и подделки отклоняются", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-11-06|x").toString("base64url"))).toBeNull();
    expect(
      decodeCursor(Buffer.from("2026-11-06T20:00:00.000Z|a;drop").toString("base64url")),
    ).toBeNull();
    expect(
      decodeCursor(Buffer.from("2026-11-06T20:00:00.000Z|a|b").toString("base64url")),
    ).toBeNull();
  });
});

describe("parseCatalogQuery", () => {
  it("значения по умолчанию", () => {
    expect(parseCatalogQuery({})).toEqual({
      competition: null,
      date: null,
      timeZone: "UTC",
      scope: "open",
      cursor: null,
      limit: 20,
    });
  });
  it("корректные значения принимаются", () => {
    const q = parseCatalogQuery({
      competition: "PL",
      date: "2026-11-05",
      tz: "Asia/Krasnoyarsk",
      scope: "finished",
      limit: "5",
    });
    expect([q.competition, q.date, q.timeZone, q.scope, q.limit]).toEqual([
      "PL",
      "2026-11-05",
      "Asia/Krasnoyarsk",
      "finished",
      5,
    ]);
  });
  it("некорректные значения заменяются безопасными", () => {
    const q = parseCatalogQuery({
      competition: "pl'; drop",
      date: "2026-02-30",
      tz: "Mars/Olympus",
      scope: "everything",
      cursor: "garbage!",
      limit: "100000",
    });
    expect([q.competition, q.date, q.timeZone, q.scope, q.cursor, q.limit]).toEqual([
      null,
      null,
      "UTC",
      "open",
      null,
      20,
    ]);
    expect(parseCatalogQuery({ limit: "500" }).limit).toBe(100);
    expect(parseCatalogQuery({ limit: "0" }).limit).toBe(1);
  });
  it("массив параметров: берется первый", () => {
    expect(parseCatalogQuery({ scope: ["upcoming", "finished"] }).scope).toBe("upcoming");
  });
  it("строка запроса без значений по умолчанию", () => {
    expect(catalogSearch(parseCatalogQuery({}))).toBe("");
    expect(catalogSearch(parseCatalogQuery({ tz: "Asia/Krasnoyarsk", scope: "upcoming" }))).toBe(
      "?tz=Asia%2FKrasnoyarsk&scope=upcoming",
    );
  });
});
