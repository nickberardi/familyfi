# Row-level security prototype (issue 374, step 2b)

Not product code and not for merging. It answers the questions the phase 2 plan put to step 2b before
the schema migration (2c) is written: does Prisma with PostgreSQL row-level security keep one
household out of another's rows, on PostgreSQL and on PGlite, and what does it cost.

`setup.sql` gives `Group` and `Device` a `householdId`, turns on RLS with a policy on it, and adds an
`familyfi_app` role that neither owns the tables nor bypasses RLS. `prototype.ts` runs 19 checks.

```sh
# PostgreSQL 16 on port 55440, a superuser called owner
prototypes/rls/reset.sh && node prototypes/rls/prototype.ts
# PGlite, served from this process the way tests and the demo use it
node prototypes/rls/pglite.mjs
```

## Results (2026-11-19)

PostgreSQL 16.15: 19 of 19 checks pass. PGlite: 16 of 16 (three checks only make sense on PostgreSQL).
1,200 concurrent reads by two households over one connection pool never saw the other's rows.
Cost: 0.14 ms more per query on PostgreSQL (1.15x on a trivial `findMany`), 0.41 ms on PGlite (1.35x).

## What 2c must do, learned here

1. **Policies read `NULLIF(current_setting('app.household_id', true), '')`.** A pooled connection
   that once set the value locally reads `''` afterwards, not NULL. Without `NULLIF`, rows written
   with no household (`''`) were visible to every later caller with none. Same for the column default.
2. **`prisma()` cannot be a plain `$extends` query hook.** The documented pattern (each query in a
   batch transaction behind `set_config`) works for model calls, but inside an interactive
   `$transaction(fn)` it runs each statement in its own batch, outside the caller's transaction: a
   write survived the caller's rollback, and on PGlite it deadlocks. `prisma()` returns the extended
   client wrapped so `$transaction(fn)` goes to the base client and sets the household first.
3. **Raw SQL skips the hook.** `$queryRaw` and `$executeRaw` (8 call sites) must run inside the
   wrapper's transaction. The 5 batch `$transaction([...])` call sites become interactive ones.
4. **Prisma promises are lazy.** A query starts when awaited, so it must be awaited inside
   `withHousehold`, not returned from it. `guarded()` awaits its handler, so requests are fine; the
   household context should await its work itself (`household.run(id, async () => await work())`).
5. **PGlite shares one superuser session across connections**, so a login role does nothing there.
   The household's opening statement also takes the role for that transaction only
   (`set_config('role', 'familyfi_app', true)`), which PGlite enforces. On PostgreSQL the app logs in
   as the role, and migrations run as the owner.
6. **Inserts need no `householdId` in code.** The column defaults to the transaction's household, and
   `WITH CHECK` refuses a row for any other household, so most create calls stay as they are.
7. **Owner path.** Lookups before a household is known (session by token, refresh, invite claim,
   sign-in, health) use a separate owner client, which bypasses RLS; that list stays short and tested.
