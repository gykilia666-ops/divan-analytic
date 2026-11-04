import { describe, expect, it } from "vitest";
import { getSupabaseConfig } from "@/lib/supabase-config";

describe("getSupabaseConfig", () => {
  it("возвращает url и publishable key", () => {
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub",
      }),
    ).toEqual({ url: "http://127.0.0.1:54321", publishableKey: "pub" });
  });
  it("падает без значений и не раскрывает их в сообщении", () => {
    expect(() =>
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      }),
    ).toThrow(/Supabase не настроен/);
    try {
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://secret-host.example",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      });
    } catch (e) {
      expect(String(e)).not.toContain("secret-host");
    }
  });
});
