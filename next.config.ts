import type { NextConfig } from "next";

/**
 * The address the desk is opened at lives in WAX_PUBLIC_HOST as host[:port],
 * so moving to another network is an environment change rather than a code
 * edit. allowedDevOrigins only accepts the hostname part.
 */
function devOrigins(): string[] | undefined {
  const value = (process.env.WAX_PUBLIC_HOST ?? "").trim();
  if (!value) return undefined;

  try {
    const host = new URL(
      /^https?:\/\//i.test(value) ? value : `http://${value}`,
    ).hostname;
    return host ? [host] : undefined;
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  // The desk is opened by its LAN address, not localhost, so dev-server
  // endpoints (HMR, fonts) must accept that origin. Without this Next answers
  // the LAN host with 403 and the page never finishes loading.
  allowedDevOrigins: devOrigins(),
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
