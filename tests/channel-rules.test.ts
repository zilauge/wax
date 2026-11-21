import assert from "node:assert/strict";
import test from "node:test";
import { canManageChannels } from "../app/lib/auth/roles.ts";
import {
  REPLY_WINDOW_MS,
  isReplyWindowOpen,
  replyWindowEndsAt,
} from "../app/lib/channels/window.ts";
import {
  mapReceiptStatus,
  mapTwilioStatus,
  nextMessageStatus,
} from "../app/lib/channels/status.ts";
import { twilioSignature, verifyTwilioSignature } from "../app/lib/channels/twilio-signature.ts";
import { metaSignatureMatches } from "../app/lib/channels/meta-signature.ts";
import {
  readStoredToken,
  serializeToken,
  tokenNeedsRefresh,
} from "../app/lib/channels/token-shape.ts";
import { advanceCursor } from "../app/lib/channels/sync-cursor.ts";
import { classifyXInboundFailure } from "../app/lib/channels/x-inbound.ts";
import {
  isOAuth1Credentials,
  oauth1Authorization,
  type OAuth1Credentials,
} from "../app/lib/channels/x-oauth1.ts";
import { createHmac } from "node:crypto";

test("only owners and admins manage channel credentials", () => {
  assert.equal(canManageChannels("owner"), true);
  assert.equal(canManageChannels("admin"), true);
  assert.equal(canManageChannels("agent"), false);
});

test("the reply window is exactly 24 hours from the last inbound message", () => {
  const at = 1_700_000_000_000;
  assert.equal(replyWindowEndsAt(at), at + REPLY_WINDOW_MS);
  assert.equal(replyWindowEndsAt(null), null);
});

test("a reply window closes at its boundary", () => {
  const at = 1_700_000_000_000;
  assert.equal(isReplyWindowOpen(at, at + REPLY_WINDOW_MS - 1), true);
  assert.equal(isReplyWindowOpen(at, at + REPLY_WINDOW_MS), false);
  assert.equal(isReplyWindowOpen(null), false);
});

test("only known WhatsApp receipt statuses are accepted", () => {
  assert.equal(mapReceiptStatus("sent"), "sent");
  assert.equal(mapReceiptStatus("delivered"), "delivered");
  assert.equal(mapReceiptStatus("read"), "read");
  assert.equal(mapReceiptStatus("failed"), "failed");
  assert.equal(mapReceiptStatus("deleted"), null);
  assert.equal(mapReceiptStatus(""), null);
});

test("receipts never move a message backwards", () => {
  assert.equal(nextMessageStatus("sent", "delivered"), "delivered");
  assert.equal(nextMessageStatus("delivered", "read"), "read");
  assert.equal(nextMessageStatus("read", "delivered"), "read");
  assert.equal(nextMessageStatus("read", "sent"), "read");
});

test("a failure is sticky, but it can replace an earlier success", () => {
  assert.equal(nextMessageStatus("sent", "failed"), "failed");
  assert.equal(nextMessageStatus("read", "failed"), "failed");
  assert.equal(nextMessageStatus("failed", "read"), "failed");
});

test("Twilio's transport states map onto the desk's four statuses", () => {
  assert.equal(mapTwilioStatus("queued"), "sent");
  assert.equal(mapTwilioStatus("sending"), "sent");
  assert.equal(mapTwilioStatus("sent"), "sent");
  assert.equal(mapTwilioStatus("delivered"), "delivered");
  assert.equal(mapTwilioStatus("read"), "read");
  assert.equal(mapTwilioStatus("undelivered"), "failed");
  assert.equal(mapTwilioStatus("FAILED"), "failed");
  assert.equal(mapTwilioStatus("canceled"), "failed");
  assert.equal(mapTwilioStatus("accepted"), "sent");
  assert.equal(mapTwilioStatus("nonsense"), null);
});

test("a Twilio signature covers the URL and every sorted parameter", () => {
  const authToken = "test-auth-token";
  const url = "https://desk.example.com/api/webhooks/twilio";
  const params = { To: "+15550001111", From: "+15550002222", Body: "Hi" };
  const signature = twilioSignature(authToken, url, params);

  assert.equal(
    verifyTwilioSignature({ authToken, url, signature, params }),
    true,
  );
  assert.equal(
    verifyTwilioSignature({
      authToken,
      url,
      signature,
      params: { ...params, Body: "Tampered" },
    }),
    false,
  );
  assert.equal(
    verifyTwilioSignature({
      authToken,
      url: "https://attacker.example/webhook",
      signature,
      params,
    }),
    false,
  );
  assert.equal(
    verifyTwilioSignature({ authToken, url, signature: null, params }),
    false,
  );
});

const oauth1: OAuth1Credentials = {
  consumerKey: "ck-test-key-1234567890",
  consumerSecret: "cs-test-secret-1234567890",
  accessToken: "at-test-token-1234567890",
  accessTokenSecret: "as-test-secret-1234567890",
};

test("an OAuth 1.0a header carries every required field and a signature", () => {
  const header = oauth1Authorization({
    method: "POST",
    url: "https://api.x.com/2/dm_conversations/with/5001/messages",
    credentials: oauth1,
    nonce: "abc123",
    timestamp: 1_700_000_000,
  });

  assert.match(header, /^OAuth /);
  for (const field of [
    "oauth_consumer_key",
    "oauth_nonce",
    "oauth_signature_method=\"HMAC-SHA1\"",
    "oauth_timestamp=\"1700000000\"",
    "oauth_token",
    "oauth_version=\"1.0\"",
    "oauth_signature=",
  ]) {
    assert.ok(header.includes(field), `missing ${field}`);
  }
});

test("the OAuth 1.0a signature is stable and covers query parameters", () => {
  const base = {
    method: "GET",
    url: "https://api.x.com/2/dm_events",
    credentials: oauth1,
    nonce: "fixed-nonce",
    timestamp: 1_700_000_000,
  };

  const first = oauth1Authorization(base);
  assert.equal(oauth1Authorization(base), first);

  const withQuery = oauth1Authorization({
    ...base,
    query: { max_results: "100" },
  });
  assert.notEqual(withQuery, first);
  assert.ok(withQuery.includes("max_results"));
});

test("OAuth 1.0a keys are only accepted when all four are present", () => {
  assert.equal(isOAuth1Credentials(oauth1), true);
  assert.equal(
    isOAuth1Credentials({ ...oauth1, accessTokenSecret: "" }),
    false,
  );
  assert.equal(isOAuth1Credentials(null), false);
  assert.equal(isOAuth1Credentials("keys"), false);
});

test("an X DM-read refusal is a stated limitation, not a transient error", () => {
  for (const status of [401, 403]) {
    const result = classifyXInboundFailure(status, null);
    assert.equal(result.capability, "unavailable");
    assert.match(result.message, /dm\.read/);
    assert.match(result.message, /Replies still send/);
  }

  const scopeRefusal = classifyXInboundFailure(400, {
    detail: "Missing required scope dm.read",
  });
  assert.equal(scopeRefusal.capability, "unavailable");
});

test("a throttled or broken X response stays an ordinary error", () => {
  const throttled = classifyXInboundFailure(429, { title: "Too Many Requests" });
  assert.equal(throttled.capability, null);
  assert.match(throttled.message, /Too Many Requests/);

  assert.equal(classifyXInboundFailure(500, null).capability, null);
});

test("a partial or failed sync never advances the cursor", () => {
  assert.equal(advanceCursor("100", "200", false), "100");
  assert.equal(advanceCursor(null, "200", false), null);
});

test("a complete sync advances to the newest item and never backwards", () => {
  assert.equal(advanceCursor("100", "200", true), "200");
  assert.equal(advanceCursor("200", "150", true), "200");
  assert.equal(advanceCursor(null, "10", true), "10");
  assert.equal(advanceCursor("100", null, true), "100");
});

test("snowflake and ISO cursors both compare in order", () => {
  assert.equal(
    advanceCursor("900719925474099", "900719925474100", true),
    "900719925474100",
  );
  assert.equal(
    advanceCursor("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", true),
    "2026-01-02T00:00:00Z",
  );
});

test("raw Meta tokens and JSON refreshable tokens are both readable", () => {
  assert.deepEqual(readStoredToken("EAAG-metatoken"), {
    accessToken: "EAAG-metatoken",
  });

  const stored = serializeToken({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: 1_700_000_000_000,
  });
  assert.deepEqual(readStoredToken(stored), {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: 1_700_000_000_000,
  });

  assert.equal(readStoredToken("   "), null);
  assert.equal(readStoredToken("{not json"), null);
  assert.equal(readStoredToken(JSON.stringify({ refreshToken: "x" })), null);
});

test("tokens refresh only when they have a refresh token and are near expiry", () => {
  const now = 1_700_000_000_000;
  assert.equal(
    tokenNeedsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 120_000 }, now),
    false,
  );
  assert.equal(
    tokenNeedsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 30_000 }, now),
    true,
  );
  assert.equal(
    tokenNeedsRefresh({ accessToken: "a", expiresAt: now - 1 }, now),
    false,
  );
});

test("Meta webhook signatures are rejected unless they match the secret", () => {
  const secret = "meta-app-secret";
  const body = JSON.stringify({ object: "instagram" });
  const header = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(metaSignatureMatches(body, header, secret), true);
  assert.equal(metaSignatureMatches(body, header, "other-secret"), false);
  assert.equal(metaSignatureMatches(body, null, secret), false);
  assert.equal(metaSignatureMatches(body, "sha1=abc", secret), false);
});
