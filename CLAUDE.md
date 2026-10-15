# Working on Build My Church

- Stack: Next.js 16 App Router + server actions, Drizzle + Postgres, Tailwind 4. TypeScript strict.
- All business logic lives in `src/server/services/*` and takes `(tx, ctx, input)`. Pages and actions stay thin.
- Mutations go through `orgAction({ perm, schema }, fn)` from `src/server/action.ts`: it checks the session and
  permission, validates with zod, runs inside `withOrg` (row-level security) and maps `AppError` to user messages.
- Every church-data table needs `org_id` and must be added to the RLS list in a migration
  (`select bmc_enable_tenant_rls('table_name')`). Write an isolation test for new tables.
- Every meaningful change writes an audit record with `audit(tx, ctx, {...})` in the same transaction.
- Contact and health fields are encrypted with `encrypt()`; use `blindIndex()` for lookups.
- Money is integer kobo. Dates display in Africa/Lagos via `src/lib/format.ts`.
- User-facing copy: plain, active voice, say what happened and how to fix it. No apologies, no jargon.
- Before committing: `npm run lint && npm run typecheck && npm test`, and `npm run build && npm run test:e2e` for UI changes.
