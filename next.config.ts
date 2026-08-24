import type { NextConfig } from "next";

// Security headers per review resolution #8: embeddable routes allow any ancestor;
// authed/sensitive routes deny framing entirely.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      {
        source: "/b/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
      ...["/dashboard/:path*", "/dashboard", "/admin/:path*", "/admin", "/manage/:path*", "/demo/:path*"].map((source) => ({
        source,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      })),
    ];
  },
};

export default nextConfig;
