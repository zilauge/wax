import { createHash } from "node:crypto";

/**
 * OAuth wiring for the social channels. Each provider is configured from
 * server-only environment variables; when they are absent the channel is
 * reported as "not configured" instead of pretending to be connected.
 */
export type SocialChannelId =
  | "instagram"
  | "whatsapp"
  | "tiktok"
  | "x"
  | "youtube";

type TokenSet = {
  accessToken: string;
  /** Present on Google and X, whose access tokens expire quickly. */
  refreshToken?: string;
  expiresIn?: number;
};

type SocialProvider = {
  id: SocialChannelId;
  name: string;
  env: string[];
  configured: () => boolean;
  authorizeUrl: (input: {
    redirectUri: string;
    state: string;
    verifier?: string;
  }) => string;
  exchange: (input: {
    code: string;
    redirectUri: string;
    verifier?: string;
  }) => Promise<TokenSet>;
  /**
   * `accessToken` is an optional credential override: Instagram messaging must
   * send with the Page token, not the user token OAuth returned.
   */
  account: (accessToken: string) => Promise<{
    id: string;
    name: string;
    accessToken?: string;
  }>;
};

/** The short-lived cookie that carries the OAuth state and PKCE verifier. */
export const CHANNEL_OAUTH_COOKIE = "wax_channel_oauth";

export type OAuthPending = {
  state: string;
  channel: SocialChannelId;
  workspaceId: string;
  verifier: string | null;
};

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function configuredWith(keys: string[]) {
  return () => keys.every((key) => Boolean(process.env[key]));
}

type GraphError = { error?: { message?: string }; error_description?: string };

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as
    | (Record<string, unknown> & GraphError)
    | null;
}

function failure(payload: Record<string, unknown> | null, status: number) {
  const message =
    payload?.error_description ??
    (payload?.error as { message?: string } | undefined)?.message ??
    `The provider responded with ${status}.`;
  return new Error(String(message));
}

async function getJson(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok || !payload) throw failure(payload, response.status);
  return payload;
}

/**
 * Instagram and WhatsApp both run on Meta's OAuth dialog; only the scopes and
 * the final account lookup differ.
 */
function metaProvider(
  id: "instagram" | "whatsapp",
  name: string,
  scopes: string[],
): SocialProvider {
  const env = ["META_APP_ID", "META_APP_SECRET"];
  const configured = configuredWith(env);

  return {
    id,
    name,
    env,
    configured,
    authorizeUrl: ({ redirectUri, state }) => {
      const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
      url.searchParams.set("client_id", process.env.META_APP_ID ?? "");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes.join(","));
      return url.toString();
    },
    exchange: async ({ code, redirectUri }) => {
      const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
      url.searchParams.set("client_id", process.env.META_APP_ID ?? "");
      url.searchParams.set("client_secret", process.env.META_APP_SECRET ?? "");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("code", code);

      const response = await fetch(url, { cache: "no-store" });
      const payload = await readJson(response);
      const token = payload?.access_token;
      if (!response.ok || typeof token !== "string") {
        throw failure(payload, response.status);
      }
      return { accessToken: token };
    },
    account: async (accessToken) => {
      const payload = await getJson(
        "https://graph.facebook.com/v21.0/me?fields=id,name",
        accessToken,
      );
      return {
        id: String(payload.id ?? ""),
        name: String(payload.name ?? name),
      };
    },
  };
}

const xProvider: SocialProvider = {
  id: "x",
  name: "X",
  env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  configured: configuredWith(["X_CLIENT_ID", "X_CLIENT_SECRET"]),
  authorizeUrl: ({ redirectUri, state, verifier }) => {
    const url = new URL("https://twitter.com/i/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", process.env.X_CLIENT_ID ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set(
      "scope",
      "tweet.read users.read dm.read dm.write offline.access",
    );
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkceChallenge(verifier ?? ""));
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },
  exchange: async ({ code, redirectUri, verifier }) => {
    const clientId = process.env.X_CLIENT_ID ?? "";
    const clientSecret = process.env.X_CLIENT_SECRET ?? "";
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier ?? "",
      }),
      cache: "no-store",
    });
    const payload = await readJson(response);
    const token = payload?.access_token;
    if (!response.ok || typeof token !== "string") {
      throw failure(payload, response.status);
    }
    return {
      accessToken: token,
      refreshToken:
        payload && typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : undefined,
      expiresIn: payload ? Number(payload.expires_in ?? 7_200) : 7_200,
    };
  },
  account: async (accessToken) => {
    const payload = await getJson(
      "https://api.x.com/2/users/me?user.fields=username",
      accessToken,
    );
    const data = (payload.data ?? {}) as { id?: string; name?: string; username?: string };
    return {
      id: String(data.id ?? ""),
      name: data.username ? `@${data.username}` : String(data.name ?? "X account"),
    };
  },
};

const tiktokProvider: SocialProvider = {
  id: "tiktok",
  name: "TikTok",
  env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  configured: configuredWith(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]),
  authorizeUrl: ({ redirectUri, state }) => {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY ?? "");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user.info.basic");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  },
  exchange: async ({ code, redirectUri }) => {
    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? "",
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
    const payload = await readJson(response);
    const token = payload?.access_token;
    if (!response.ok || typeof token !== "string") {
      throw failure(payload, response.status);
    }
    return { accessToken: token };
  },
  account: async (accessToken) => {
    const payload = await getJson(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      accessToken,
    );
    const user = ((payload.data ?? {}) as { user?: Record<string, unknown> }).user ?? {};
    return {
      id: String(user.open_id ?? ""),
      name: String(user.display_name ?? "TikTok account"),
    };
  },
};

/**
 * YouTube runs on Google OAuth. The linked account is the channel, and the
 * force-ssl scope is what allows reading comment threads and posting replies.
 */
const youtubeProvider: SocialProvider = {
  id: "youtube",
  name: "YouTube",
  env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  configured: configuredWith(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]),
  authorizeUrl: ({ redirectUri, state }) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/youtube.force-ssl",
    );
    // Without these Google returns no refresh token, and replies break in an hour.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  },
  exchange: async ({ code, redirectUri }) => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const payload = await readJson(response);
    const token = payload?.access_token;
    if (!response.ok || typeof token !== "string") {
      throw failure(payload, response.status);
    }
    return {
      accessToken: token,
      refreshToken:
        payload && typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : undefined,
      expiresIn: payload ? Number(payload.expires_in ?? 3_600) : 3_600,
    };
  },
  account: async (accessToken) => {
    const payload = await getJson(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      accessToken,
    );
    const channel = rows(payload.items)[0];
    const snippet = (channel?.snippet ?? {}) as Record<string, unknown>;
    return {
      id: String(channel?.id ?? ""),
      name: String(snippet.title ?? "YouTube channel"),
    };
  },
};

const GRAPH_ROOT = "https://graph.facebook.com/v21.0";

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * WhatsApp webhooks identify the tenant by phone number id, not by account id,
 * so the link step records the first number on the user's business account.
 * Without the business_management scope this discovery fails; the account id is
 * then stored and sends surface the provider's error instead of guessing.
 */
async function discoverWhatsAppNumber(accessToken: string) {
  try {
    const businesses = await getJson(
      `${GRAPH_ROOT}/me/businesses?fields=id`,
      accessToken,
    );

    for (const business of rows(businesses.data)) {
      if (!business.id) continue;
      const accounts = await getJson(
        `${GRAPH_ROOT}/${business.id}/owned_whatsapp_business_accounts?fields=id`,
        accessToken,
      );

      for (const account of rows(accounts.data)) {
        if (!account.id) continue;
        const numbers = await getJson(
          `${GRAPH_ROOT}/${account.id}/phone_numbers?fields=id,display_phone_number,verified_name`,
          accessToken,
        );
        const number = rows(numbers.data)[0];
        if (number?.id) {
          return {
            id: String(number.id),
            name: String(
              number.display_phone_number ?? number.verified_name ?? "WhatsApp",
            ),
          };
        }
      }
    }
  } catch {
    // Discovery needs business_management; fall through to the account id.
  }

  return null;
}

/**
 * Instagram's messaging API is keyed by the professional account id and needs
 * the Page token that owns it, so the link step walks the user's pages instead
 * of trusting /me (which is the Facebook user, not the Instagram account).
 */
async function discoverInstagramAccount(accessToken: string) {
  try {
    const pages = await getJson(
      `${GRAPH_ROOT}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`,
      accessToken,
    );

    for (const page of rows(pages.data)) {
      const instagram = page.instagram_business_account as
        | { id?: unknown; username?: unknown }
        | undefined;
      if (!instagram?.id) continue;

      return {
        id: String(instagram.id),
        name: instagram.username
          ? `@${String(instagram.username)}`
          : String(page.name ?? "Instagram"),
        accessToken:
          typeof page.access_token === "string" ? page.access_token : undefined,
      };
    }
  } catch {
    // Discovery needs pages_show_list; fall through to the account id.
  }

  return null;
}

const whatsappMeta = metaProvider("whatsapp", "WhatsApp", [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
  "business_management",
]);

const providers: Record<SocialChannelId, SocialProvider> = {
  instagram: {
    ...metaProvider("instagram", "Instagram", [
      "instagram_basic",
      "instagram_manage_messages",
      "pages_messaging",
      "pages_show_list",
      "pages_manage_metadata",
      "business_management",
    ]),
    account: async (accessToken) =>
      (await discoverInstagramAccount(accessToken)) ??
      metaProvider("instagram", "Instagram", []).account(accessToken),
  },
  whatsapp: {
    ...whatsappMeta,
    account: async (accessToken) =>
      (await discoverWhatsAppNumber(accessToken)) ??
      whatsappMeta.account(accessToken),
  },
  tiktok: tiktokProvider,
  x: xProvider,
  youtube: youtubeProvider,
};

export function getProvider(value: string): SocialProvider | null {
  return providers[value as SocialChannelId] ?? null;
}
