import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  compress: false,
  poweredByHeader: false,
  async rewrites() {
    const base = (process.env.API_BASE_URL || "http://localhost:8001").replace(/\/$/, "");
    return [
      {
        source: "/api/v1/:path*",
        destination: `${base}/api/v1/:path*`
      },
      {
        source: "/health",
        destination: `${base}/health`
      },
    ];
  },
  async headers() {
    const storage = process.env.STORAGE_ORIGIN || "";
    const csp = [
      "default-src 'self'",
      `img-src 'self' blob: data: ${storage}`,
      `media-src 'self' blob: ${storage}`,
      `connect-src 'self' ${storage}`,
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join("; ");
    return [{
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: csp
        },
        {
          key: "Referrer-Policy",
          value: "no-referrer"
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff"
        },
      ]
    }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};
export default nextConfig;
