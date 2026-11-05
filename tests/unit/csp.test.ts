import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/lib/csp";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

describe("buildCsp", () => {
  it("production: скрипты только по nonce, без unsafe-eval и unsafe-inline", () => {
    const d = directives(buildCsp({ nonce: "abc", dev: false, supabaseUrl: null, https: true }));
    expect(d.get("script-src")).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.has("upgrade-insecure-requests")).toBe(true);
  });

  it("dev: unsafe-eval и websocket только в dev", () => {
    const d = directives(buildCsp({ nonce: "n", dev: true, supabaseUrl: null, https: false }));
    expect(d.get("script-src")).toContain("'unsafe-eval'");
    expect(d.get("connect-src")).toContain("ws:");
    expect(d.has("upgrade-insecure-requests")).toBe(false);
  });

  it("form-action допускает Supabase Auth (только origin) и GitHub", () => {
    const d = directives(
      buildCsp({
        nonce: "n",
        dev: false,
        supabaseUrl: "https://xyz.supabase.co/rest/v1",
        https: true,
      }),
    );
    expect(d.get("form-action")).toEqual([
      "'self'",
      "https://xyz.supabase.co",
      "https://github.com",
    ]);
  });

  it("некорректный адрес Supabase не попадает в политику", () => {
    const d = directives(buildCsp({ nonce: "n", dev: false, supabaseUrl: "::bad", https: false }));
    expect(d.get("form-action")).toEqual(["'self'", "https://github.com"]);
  });
});

describe("createNonce", () => {
  it("случайный base64 длиной 24 символа", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});
