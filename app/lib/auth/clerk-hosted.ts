import "server-only";

/**
 * Clerk's hosted Account Portal. The publishable key encodes the frontend API
 * host (`pk_test_<base64url(host$)>`). Development instances serve the portal
 * on the bare `*.accounts.dev` host while their API lives on
 * `*.clerk.accounts.dev`, so the `.clerk` label is dropped there.
 */
export function clerkFrontendHost() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.split("_").slice(2).join("_");
  if (!encoded) return null;

  try {
    // Clerk terminates the decoded value with "$" (e.g. "host.clerk.accounts.dev$").
    const decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/")).replace(
      /\$+$/,
      "",
    );
    if (!decoded.includes(".")) return null;

    return decoded.endsWith(".clerk.accounts.dev")
      ? decoded.replace(/\.clerk\.accounts\.dev$/, ".accounts.dev")
      : decoded;
  } catch {
    return null;
  }
}

type Query = Record<string, string | string[] | undefined>;

/**
 * A loopback or LAN address is a development machine: it serves plain http even
 * when the app is opened at its local IP rather than localhost.
 */
function isLocalAddress(hostname: string) {
  const name = hostname.toLowerCase();
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ||
    name === "[::1]" ||
    name.startsWith("[fe80:") ||
    name.startsWith("[fd")
  );
}

function hostnameOf(host: string) {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  return trimmed.split(":")[0] ?? trimmed;
}

/** This app's own origin, so Clerk can send the browser back here. */
export function requestOrigin(headers: Headers) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return null;

  const firstHost = host.split(",")[0]!.trim();
  const proto =
    headers.get("x-forwarded-proto") ??
    (isLocalAddress(hostnameOf(firstHost)) ? "http" : "https");

  return `${proto.split(",")[0]!.trim()}://${firstHost}`;
}

/**
 * Clerk resolves `redirect_url` against its own origin, so a relative value
 * would land on the portal host (and 404). Always hand it an absolute URL.
 */
export function absoluteRedirect(value: string | undefined, origin: string | null) {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (!origin) return undefined;

  try {
    return new URL(value, `${origin}/`).toString();
  } catch {
    return undefined;
  }
}

/** The hosted page for `mode`, carrying Clerk's own handoff params along. */
export function hostedAuthUrl(
  mode: "sign-in" | "sign-up",
  params: Query,
  origin: string | null,
) {
  const host = clerkFrontendHost();
  if (!host) return null;

  const url = new URL(`https://${host}/${mode}`);

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // `__clerk_*` carries tickets and verification state from Clerk's redirect.
    if (name === "redirect_url" || name.startsWith("__clerk")) {
      url.searchParams.set(name, Array.isArray(value) ? value[0] : value);
    }
  }

  const redirect = absoluteRedirect(url.searchParams.get("redirect_url") ?? undefined, origin);
  if (redirect) url.searchParams.set("redirect_url", redirect);

  return url.toString();
}
