import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desk is opened by its LAN address, not localhost, so dev-server
  // endpoints (HMR, fonts) must accept that origin. Without this Next answers
  // the LAN host with 403 and the page never finishes loading.
  allowedDevOrigins: ["172.20.204.10"],
  // The desk is an authenticated console: it must never be framed, must not
  // leak referrers, and only needs camera/microphone for its media rooms.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
  /* config options here */
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
