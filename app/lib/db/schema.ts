/**
 * SQLite schema for the workspace desk. Kept dependency-free so both the Next
 * server (app/lib/db.ts) and the admin scripts in scripts/ can load it through
 * Node's built-in SQLite.
 */
export const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    company TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    phone TEXT,
    phone_verified_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memberships (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    first_attempt_at INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS channels (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    handle TEXT NOT NULL,
    monogram TEXT NOT NULL,
    color TEXT NOT NULL,
    connected INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, id)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    handle TEXT NOT NULL,
    company TEXT NOT NULL,
    color TEXT NOT NULL,
    telegram_chat_id TEXT
  );

  -- Every address a contact is reachable at, one row per channel. The unique
  -- index is what makes an inbound address resolve to exactly one contact in a
  -- workspace, so the same person is one timeline across channels.
  CREATE TABLE IF NOT EXISTS contact_identities (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (workspace_id, channel_id, address)
  );

  CREATE INDEX IF NOT EXISTS contact_identities_contact_idx
    ON contact_identities (workspace_id, contact_id);

  CREATE TABLE IF NOT EXISTS queues (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sla_minutes INTEGER NOT NULL DEFAULT 15,
    color TEXT NOT NULL DEFAULT '#6366f1',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agent_presence (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('available', 'busy', 'away')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'pending', 'resolved')),
    assignee_user_id TEXT REFERENCES users(id),
    queue_id TEXT REFERENCES queues(id),
    first_response_at INTEGER,
    sla_due_at INTEGER,
    unread INTEGER NOT NULL DEFAULT 0,
    last_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK (author IN ('agent', 'contact')),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent'
      CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    error TEXT,
    external_id TEXT UNIQUE,
    -- A retried server action must not send the same reply twice.
    client_nonce TEXT UNIQUE
  );

  CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON messages (conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    caller TEXT NOT NULL,
    company TEXT NOT NULL,
    hold TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    state TEXT NOT NULL,
    queue_id TEXT REFERENCES queues(id),
    assignee_user_id TEXT REFERENCES users(id),
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    duration TEXT NOT NULL,
    host TEXT NOT NULL,
    attendees TEXT NOT NULL,
    status TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  -- One Telegram bot per workspace. The secret a bot sends with every update is
  -- stored as a SHA-256 hash, so the plaintext never sits in the database and a
  -- single secret can never be bound to two tenants.
  CREATE TABLE IF NOT EXISTS telegram_bindings (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    secret_hash TEXT NOT NULL UNIQUE,
    bot_username TEXT,
    created_at INTEGER NOT NULL
  );

  -- One linked social account per channel and workspace. Tokens are only ever
  -- read server-side, so the browser never receives them. The provider column
  -- names the API family (meta, tiktok, x, wati); the unique pair stops two workspaces
  -- claiming the same external account, which would make inbound routing
  -- ambiguous and could cross tenant boundaries.
  CREATE TABLE IF NOT EXISTS channel_connections (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    account_name TEXT,
    access_token TEXT NOT NULL,
    last_error TEXT,
    connected_at INTEGER NOT NULL,
    -- Where the polling sync stopped: a message id (Discord) or an ISO date
    -- (YouTube). Push-driven channels leave it NULL.
    cursor TEXT,
    -- What the provider last allowed for inbound ("ready" / "unavailable"),
    -- with the reason, so settings and the inbox can state a limitation that
    -- is the provider's, not a fault in the desk.
    inbound_state TEXT,
    inbound_note TEXT,
    PRIMARY KEY (workspace_id, channel_id),
    UNIQUE (provider, external_id)
  );

  -- Who changed a channel connection, and when. Owner/admin actions need a
  -- trail, especially disconnects that silently stop delivery.
  CREATE TABLE IF NOT EXISTS channel_audit (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('connected', 'disconnected')),
    actor_user_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS channel_audit_workspace_idx
    ON channel_audit (workspace_id, created_at);

  -- One-time codes for the mobile number. Only a salted hash is stored, every
  -- row expires, and the attempt counter caps brute-force guesses.
  CREATE TABLE IF NOT EXISTS phone_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_salt TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS phone_verifications_user_idx
    ON phone_verifications (user_id, created_at);

  -- One row per block a person reserves for themselves. The kind drives the
  -- colour and the behaviour: a focus block is the boundary the calendar warns
  -- teammates about.
  CREATE TABLE IF NOT EXISTS calendar_blocks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('focus', 'meeting', 'admin', 'break')),
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    note TEXT,
    room_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS calendar_blocks_workspace_idx
    ON calendar_blocks (workspace_id, start_at);

  -- The working window per weekday (0 = Monday). Missing rows mean the default
  -- 09:00-17:00, so a workspace needs no setup before it can show boundaries.
  CREATE TABLE IF NOT EXISTS calendar_hours (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id, weekday)
  );

  -- A media room. Participants are ephemeral and live in the signaling hub;
  -- this row is the durable identity an invite links to.
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );
`;
