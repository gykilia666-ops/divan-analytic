import type { NextConfig } from "next";

// Базовые security headers. Content-Security-Policy с nonce ставит src/proxy.ts (этап 10, ADR-056):
// nonce у каждого ответа свой, поэтому статическим заголовком здесь его задать нельзя.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
