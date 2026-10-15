# Build My Church

Church management for Nigerian churches: members and families, first-timer follow-up, attendance and check-in,
children's check-in with parent alerts, tithes and offerings with Paystack, E-Memo approvals, service schedules,
messaging (SMS, email, WhatsApp) and multi-branch oversight. Built to protect member data under the Nigeria Data Protection Act.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router, server actions), React 19, TypeScript (strict) |
| UI | Tailwind CSS 4, Radix UI primitives, Lucide icons, Geist font |
| Database | PostgreSQL 16 with Drizzle ORM and SQL migrations |
| Background work | A Postgres-backed job queue (`SKIP LOCKED`) and a worker process |
| Tests | Vitest (unit and integration against a real database), Playwright (browser, desktop and mobile) |

## Getting started

Requirements: Node.js 20.11+ and PostgreSQL 16 (or Docker).

```bash
# 1. Database: either Docker…
docker compose up -d
# …or an existing Postgres server:
psql -U postgres -f scripts/setup-db.sql

# 2. Configuration
cp .env.example .env
# fill ENCRYPTION_KEY, BLIND_INDEX_KEY and SESSION_SECRET with:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Install, migrate, run
npm install
npm run db:migrate
npm run dev            # web app on http://localhost:3000 plus the background worker
```

Create your church at `/sign-up`. In development, emails are not sent: open `/dev/mailbox` to read them.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | App and worker with hot reload |
| `npm run build` / `npm start` | Production build and server |
| `npm run worker` | Background worker (messages, PDFs, scheduled jobs) |
| `npm run db:generate` | Create a migration after changing `src/server/db/schema` |
| `npm run db:migrate` | Apply migrations and set database grants |
| `npm test` | Unit and integration tests (uses `buildmychurch_test`) |
| `npm run test:e2e` | Browser tests (build first) |
| `npm run lint` / `npm run typecheck` | Static checks |

## How it's built

```
src/
  app/(auth)/       sign-in, sign-up, two-step verification, password reset, invitations
  app/(app)/        the signed-in app (one folder per module)
  components/       UI kit (components/ui) and the app shell
  server/
    db/             Drizzle schema, client, and withOrg() for tenant-scoped transactions
    auth/           sessions, permissions and roles, password hashing, TOTP
    services/       business logic, one file per module (no React, fully testable)
    jobs/           queue, worker, scheduler and job handlers
    providers/      email (Resend/SMTP/log), SMS, payments, storage
  lib/              formatting (naira, WAT dates), phone numbers, helpers
drizzle/            SQL migrations (including row-level security)
tests/              unit, integration and e2e tests
```

### Security

- **Tenant isolation in the database.** Every church-data table has a Postgres row-level security policy. The app
  connects as a role that can only see rows for the church set on the current transaction (`withOrg`), so a missing
  `WHERE` clause can't leak another church's data. Tests prove this.
- **Permissions** are checked on every server action (`orgAction`) and every page. Roles are editable per church.
- **Encryption at rest** for phone numbers, emails, addresses and health details (AES-256-GCM), with keyed blind
  indexes for lookups.
- **Accounts:** Argon2id passwords, lockout after 5 failed attempts, rate limits, TOTP two-step verification with
  recovery codes, HTTP-only session cookies stored hashed.
- **Audit log:** append-only; the app's database role has no permission to edit or delete it.
- **Headers:** strict Content Security Policy, HSTS, no framing.

## Deployment

Any Node host works (Render, Railway, Fly.io, a VM) with a managed Postgres (Neon, Supabase, AWS RDS).
Run two processes from the same build: `npm start` (web) and `npm run worker` (background jobs).
Run `npm run db:migrate` on each deploy with `DATABASE_ADMIN_URL` set. A Dockerfile is included for container hosts.
