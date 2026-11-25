# Wax

An omnichannel service desk: one timeline per customer across SMS, WhatsApp,
Telegram, Instagram, X, Discord and YouTube, with queues, first-response SLAs,
assignment, internal notes and analytics.

Next.js 16 (App Router, React 19), Clerk for sign-in, and Node's built-in
`node:sqlite` for storage. No database server to run.

## Run it

```bash
npm install
npm run dev          # http://172.20.204.10:53062
```

Both scripts bind all interfaces on port 53062. Set the address the desk is
opened at in `WAX_PUBLIC_HOST` as `host[:port]` (for example
`WAX_PUBLIC_HOST=172.20.204.10:53062` in `.env.local`), then open
`http://172.20.204.10:53062`, not localhost. That one value feeds both the
dev-server origin allow-list and the fallback used when building OAuth redirect
URLs, so moving to another network is an environment change, not a code edit.

Sign in with Clerk. A new account gets an empty workspace with its channel
catalogue and two queues; nothing is fabricated.

## Demo customers

The desk can be explored with two showroom contacts per workspace. They are
ordinary rows, so merge, notes, export, delete and SLA behave exactly as they do
for a real customer, and they are labelled **Demo** in the inbox and directory.

```bash
npm run db:demo-contacts
```

The seeder is idempotent and runs across every workspace in the database. It
does not connect a channel, so replies are stored but reported as not delivered
until one is linked — see below.

## Channels

Credentials live in the environment, never in the browser:

| Channel | What to set |
| --- | --- |
| Telegram | `TELEGRAM_BOT_TOKEN` (create a bot with @BotFather), then `npm run telegram:bind` |
| SMS / WhatsApp | Twilio credentials in the environment; the webhook is `/api/webhooks/twilio` |
| WhatsApp Cloud API | Meta credentials; webhook `/api/webhooks/whatsapp` |
| Instagram | Meta app credentials; webhook `/api/webhooks/instagram` |
| X | OAuth 1.0a keys; replies only unless the app has DM read |
| Discord | Bot token entered in Settings |

Until a channel has credentials, sends are stored and marked **Not delivered**
with the provider's reason; they are retried with backoff once credentials are
present. Nothing pretends to have been delivered.

## Background work

Delivery retries, SLA escalation and the daily backup run on in-process timers,
each behind a lease in `job_state` so restarts and multiple instances cannot
double-send. The last outcome of every job is shown in **Settings → Background
jobs**.

To drive them from an external scheduler instead (or as well), set
`WAX_JOBS_TOKEN` and call:

```bash
curl -H "Authorization: Bearer $WAX_JOBS_TOKEN" https://your-host/api/jobs/tick
```

The endpoint is disabled (404) when the token is unset.

## Backups and restore

```bash
npm run db:backup
npm run db:restore -- .data/backups/<file>.db                 # verify only
npm run db:restore -- .data/backups/<file>.db --to .data/wax.db --force
```

`db:restore` opens the copy read-only, runs `PRAGMA integrity_check`, prints the
row counts and refuses to restore a damaged file. Stop the server before
restoring over the live database. Run the verification drill regularly: a
backup that has never been opened is not yet a recovery plan.

Environment: `WAX_DB_PATH` (default `.data/wax.db`), `WAX_BACKUP_DISABLED=1`,
`WAX_RETRY_DISABLED=1`.

## Checks

```bash
npx tsc --noEmit
npx eslint app
npm test
```

`npm test` runs the Node test runner over the pure rules: channel status
mapping and signatures, calendar rules, schema, FTS query sanitisation, retry
backoff and analytics medians. CI runs the same three commands.
