import { createHmac, randomBytes } from "node:crypto";

/**
 * OAuth 1.0a user-context signing.
 *
 * X's v2 DM endpoints accept either an OAuth 2.0 user token or OAuth 1.0a user
 * context ("legacy support"), and the console hands out API key/secret plus
 * access token/secret pairs. Those keys are what most self-hosted installs
 * already have, so the desk can sign requests with them instead of forcing an
 * OAuth 2.0 app.
 */
export type OAuth1Credentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

/** RFC 3986: encodeURIComponent leaves !*'() alone, so escape them too. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function oauth1Authorization({
  method,
  url,
  credentials,
  query = {},
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000),
}: {
  method: string;
  /** Absolute URL without a query string. */
  url: string;
  credentials: OAuth1Credentials;
  /** Query parameters, which must be part of the signature for GET requests. */
  query?: Record<string, string>;
  nonce?: string;
  timestamp?: number;
}): string {
  const params: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
    ...query,
  };

  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    encode(url),
    encode(normalized),
  ].join("&");

  const signingKey = `${encode(credentials.consumerSecret)}&${encode(
    credentials.accessTokenSecret,
  )}`;

  const signature = createHmac("sha1", signingKey)
    .update(baseString, "utf8")
    .digest("base64");

  const header: Record<string, string> = {
    ...params,
    oauth_signature: signature,
  };

  return `OAuth ${Object.keys(header)
    .sort()
    .map((key) => `${encode(key)}="${encode(header[key])}"`)
    .join(", ")}`;
}

/** Validates the shape the settings form submits. */
export function isOAuth1Credentials(value: unknown): value is OAuth1Credentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Record<keyof OAuth1Credentials, unknown>>;
  return (
    typeof candidate.consumerKey === "string" &&
    candidate.consumerKey.length >= 10 &&
    typeof candidate.consumerSecret === "string" &&
    candidate.consumerSecret.length >= 10 &&
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length >= 10 &&
    typeof candidate.accessTokenSecret === "string" &&
    candidate.accessTokenSecret.length >= 10
  );
}
