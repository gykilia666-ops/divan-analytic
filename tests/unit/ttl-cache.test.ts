import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "@/lib/ttl-cache";

describe("createTtlCache", () => {
  it("отдает сохраненное значение до истечения срока", async () => {
    let t = 0;
    const cache = createTtlCache<number>(60_000, () => t);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cache.get(load)).toBe(1);
    t = 59_999;
    expect(await cache.get(load)).toBe(1);
    t = 60_000;
    expect(await cache.get(load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("одновременные промахи делят одну загрузку", async () => {
    const cache = createTtlCache<string>(1000, () => 0);
    let resolve: (v: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const a = cache.get(load);
    const b = cache.get(load);
    resolve("ok");
    expect(await Promise.all([a, b])).toEqual(["ok", "ok"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("ошибка не кешируется", async () => {
    const cache = createTtlCache<number>(1000, () => 0);
    await expect(cache.get(() => Promise.reject(new Error("db")))).rejects.toThrow("db");
    expect(await cache.get(() => Promise.resolve(7))).toBe(7);
  });
});
