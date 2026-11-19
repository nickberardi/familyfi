/**
 * Row-level security with Prisma: prototype for issue 374, step 2b. Not product code.
 *
 *   PGPORT=55440 node prototypes/rls/prototype.ts
 *
 * Expects reset.sh to have prepared the database. Connects as the owner (bypasses RLS, stands in for
 * the "before a household is known" path) and as familyfi_app (subject to RLS).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { AsyncLocalStorage } from "node:async_hooks";

const port = process.env.PGPORT ?? "55440";
const host = process.env.PGHOST ?? "127.0.0.1";
const ownerUrl = process.env.OWNER_URL ?? `postgresql://owner@${host}:${port}/familyfi`;
const appUrl = process.env.APP_URL ?? `postgresql://familyfi_app@${host}:${port}/familyfi`;
/** PGlite has one superuser; the app's sessions become familyfi_app with SET ROLE. */
const setRole = process.env.SET_ROLE === "1";

const household = new AsyncLocalStorage<string>();
/**
 * Prisma's promises are lazy: the query starts when it is awaited, not when it is built. Awaiting
 * inside the context is what puts the query in it.
 */
const withHousehold = <T>(id: string, work: () => Promise<T>) => household.run(id, async () => await work());
const current = () => household.getStore() ?? "";

function client(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c TimeZone=UTC" }) });
}

/**
 * The statement that opens every household transaction. On PGlite every connection shares one
 * superuser session, so the role is also taken for this transaction only (`set_config('role', …, true)`
 * is SET LOCAL ROLE); on PostgreSQL the app already logs in as familyfi_app.
 */
function enter(db: { $executeRaw: PrismaClient["$executeRaw"] }) {
  return setRole
    ? db.$executeRaw`SELECT set_config('role', 'familyfi_app', TRUE), set_config('app.household_id', ${current()}, TRUE)`
    : db.$executeRaw`SELECT set_config('app.household_id', ${current()}, TRUE)`;
}

/**
 * The household-bound client. Every operation outside an interactive transaction runs as a two-step
 * batch transaction: set the household for this transaction only, then the query. An interactive
 * `$transaction(fn)` sets it once, first, on the transaction's own connection.
 */
function householdClient(base: PrismaClient) {
  const scoped = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([
            enter(base),
            query(args),
          ]);
          return result;
        },
      },
    },
  });
  /**
   * What `prisma()` would return: model calls go through the extension, and an interactive
   * `$transaction(fn)` goes to the base client with the household set first, because the
   * extension's own batch would otherwise run each statement outside the caller's transaction.
   */
  const bound = new Proxy(scoped, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return (work: unknown) => {
          if (typeof work !== "function") throw new Error("batch $transaction([...]) is not supported on the household client");
          return base.$transaction(async (tx) => {
            await enter(tx);
            return (work as (tx: unknown) => Promise<unknown>)(tx);
          });
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as typeof scoped;
  return {
    scoped,
    bound,
    /** Interactive transactions on the base client, the household set first. */
    async transaction<T>(work: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>) {
      return base.$transaction(async (tx) => {
        await enter(tx);
        return work(tx);
      });
    },
  };
}

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}
async function rejects(work: () => Promise<unknown>) {
  try {
    await work();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message.split("\n").filter(Boolean).slice(-1)[0] : String(error);
  }
}

async function main() {
  const owner = client(ownerUrl);
  const base = setRole ? client(ownerUrl) : client(appUrl);
  const { scoped, bound, transaction } = householdClient(base);

  // 1. Each household writes and reads its own rows.
  await withHousehold("house-a", () => scoped.group.create({ data: { id: "g-a", kind: "family", name: "A's kid" } }));
  await withHousehold("house-b", () => scoped.group.create({ data: { id: "g-b", kind: "family", name: "B's kid" } }));
  const aSees = await withHousehold("house-a", () => scoped.group.findMany({ select: { id: true } }));
  const bSees = await withHousehold("house-b", () => scoped.group.findMany({ select: { id: true } }));
  check("a household reads only its rows", aSees.map((g) => g.id).join() === "g-a" && bSees.map((g) => g.id).join() === "g-b", `A sees ${aSees.map((g) => g.id)}, B sees ${bSees.map((g) => g.id)}`);

  const ownerRows = await owner.$queryRaw<{ id: string; householdId: string }[]>`SELECT id, "householdId" FROM "Group" ORDER BY id`;
  check("rows carry the household from the setting, with no householdId in the query", ownerRows.map((r) => `${r.id}=${r.householdId}`).join() === "g-a=house-a,g-b=house-b", ownerRows.map((r) => `${r.id}=${r.householdId}`).join());

  // 2. Another household's row by id: not found, not updated, not deleted.
  const byId = await withHousehold("house-a", () => scoped.group.findUnique({ where: { id: "g-b" } }));
  check("findUnique on another household's id returns null", byId === null);
  const updateErr = await rejects(() => withHousehold("house-a", () => scoped.group.update({ where: { id: "g-b" }, data: { name: "hijacked" } })));
  check("update of another household's row fails as not found", updateErr !== "", updateErr);
  const many = await withHousehold("house-a", () => scoped.group.updateMany({ data: { name: "renamed" } }));
  check("an unfiltered updateMany touches only the caller's rows", many.count === 1, `count ${many.count}`);
  const deleted = await withHousehold("house-a", () => scoped.group.deleteMany({ where: { id: "g-b" } }));
  check("deleteMany of another household's id deletes nothing", deleted.count === 0, `count ${deleted.count}`);

  // 3. Writing a row for another household is refused by WITH CHECK.
  const forged = await rejects(() =>
    withHousehold("house-a", () => transaction((tx) => tx.$executeRaw`INSERT INTO "Group" (id, kind, name, "updatedAt", "householdId") VALUES ('g-x', 'family', 'x', now(), 'house-b')`)),
  );
  // Raw statements skip the extension's query hook entirely: they need the transaction wrapper.
  const rawOutside = await withHousehold("house-a", () => scoped.$queryRaw<{ id: string }[]>`SELECT id FROM "Group"`);
  check("a raw query on the extended client is not scoped by the extension (needs the wrapper)", setRole ? rawOutside.length === 2 : rawOutside.length === 0, `${rawOutside.length} rows: on PostgreSQL the app role with no household sees none; on PGlite the superuser session sees all`);
  check("inserting a row for another household is refused", /row-level security/.test(forged), forged);

  // 4. No household set: nothing visible, nothing written.
  const none = await scoped.group.findMany();
  check("with no household, no rows are visible", none.length === 0, `${none.length} rows`);
  const noneWrite = await rejects(() => scoped.group.create({ data: { id: "g-none", kind: "family", name: "none" } }));
  check("with no household, a create is refused", noneWrite !== "", noneWrite);
  if (!setRole) {
    const plain = await base.group.findMany();
    check("the unextended app client sees nothing (no setting leaks into a pooled connection)", plain.length === 0, `${plain.length} rows`);
  }

  // 5. Interactive transactions.
  // On PGlite the extension's batch inside an interactive transaction waits on that transaction's own
  // session and times out, so these two run on PostgreSQL only.
  if (!setRole) {
    const viaExtension = await withHousehold("house-a", () => scoped.$transaction(async (tx) => tx.group.findMany({ select: { id: true } })));
    check("an interactive transaction on the extended client sees the household", viaExtension.length === 1, `${viaExtension.length} rows (the extension's query hook inside an interactive transaction)`);
    // Does the extension's own batch transaction escape an interactive one? Write, then throw.
    await rejects(() =>
      withHousehold("house-a", () =>
        scoped.$transaction(async (tx) => {
          await tx.group.create({ data: { id: "g-rollback", kind: "family", name: "should roll back" } });
          throw new Error("abort");
        }),
      ),
    );
    const survived = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Group" WHERE id = 'g-rollback'`;
    check("known problem, shown: the plain extension's write escapes an interactive transaction and survives its rollback", Number(survived[0].n) === 1, `${survived[0].n} rows left after the throw`);
  }
  await owner.$executeRaw`DELETE FROM "Group" WHERE id = 'g-rollback'`.catch(() => 0);
  await rejects(() =>
    withHousehold("house-a", () =>
      bound.$transaction(async (tx) => {
        await tx.group.create({ data: { id: "g-rollback3", kind: "family", name: "should roll back" } });
        throw new Error("abort");
      }),
    ),
  );
  const survived3 = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Group" WHERE id = 'g-rollback3'`;
  check("the bound client's interactive transaction rolls back a write with it", Number(survived3[0].n) === 0, `${survived3[0].n} rows left after the throw`);
  const boundReads = await withHousehold("house-b", () => bound.$transaction(async (tx) => tx.group.findMany({ select: { id: true } })));
  const boundModel = await withHousehold("house-b", () => bound.group.findMany({ select: { id: true } }));
  check("the bound client scopes both model calls and interactive transactions", boundReads.map((g) => g.id).join() === "g-b" && boundModel.map((g) => g.id).join() === "g-b", `${boundReads.map((g) => g.id)} / ${boundModel.map((g) => g.id)}`);
  await rejects(() =>
    withHousehold("house-a", () =>
      transaction(async (tx) => {
        await tx.group.create({ data: { id: "g-rollback2", kind: "family", name: "should roll back" } });
        throw new Error("abort");
      }),
    ),
  );
  const survived2 = await owner.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Group" WHERE id = 'g-rollback2'`;
  check("a write through the transaction wrapper rolls back with it", Number(survived2[0].n) === 0, `${survived2[0].n} rows left after the throw`);

  const viaWrapper = await withHousehold("house-a", () =>
    transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${current()} FOR UPDATE`;
      const groups = await tx.group.findMany({ select: { id: true } });
      await tx.device.create({ data: { id: "d-a", mac: "aa:aa:aa:aa:aa:01", groupId: groups[0]?.id } });
      return groups;
    }),
  );
  check("the transaction wrapper sets the household for every statement in it", viaWrapper.map((g) => g.id).join() === "g-a", viaWrapper.map((g) => g.id).join());

  // 6. Many concurrent requests from different households over one pool.
  let leaks = 0;
  const rounds = 40;
  const width = 30;
  for (let round = 0; round < rounds; round++) {
    await Promise.all(
      Array.from({ length: width }, (_, i) => {
        const id = i % 2 === 0 ? "house-a" : "house-b";
        const expect = id === "house-a" ? "g-a" : "g-b";
        return withHousehold(id, async () => {
          const seen = i % 3 === 0
            ? await transaction((tx) => tx.group.findMany({ select: { id: true } }))
            : await scoped.group.findMany({ select: { id: true } });
          if (seen.length !== 1 || seen[0].id !== expect) leaks++;
        });
      }),
    );
  }
  check(`${rounds * width} concurrent reads across two households over one pool never see the other's rows`, leaks === 0, `${leaks} wrong answers`);

  // 7. Cost: the same read, owner client (no RLS, no wrapper) against the household client.
  const n = 1000;
  const time = async (label: string, work: () => Promise<unknown>) => {
    for (let i = 0; i < 50; i++) await work();
    const start = performance.now();
    for (let i = 0; i < n; i++) await work();
    const ms = (performance.now() - start) / n;
    console.log(`TIME  ${label}: ${ms.toFixed(3)} ms per query`);
    return ms;
  };
  const plainMs = await time("findMany, no RLS", () => owner.group.findMany({ where: { householdId: "house-a" } as never }).catch(() => owner.group.findMany()));
  const scopedMs = await time("findMany, household client", () => withHousehold("house-a", () => scoped.group.findMany()));
  check("the household client's extra cost per query", true, `${(scopedMs - plainMs).toFixed(3)} ms (${(scopedMs / plainMs).toFixed(2)}x)`);

  await owner.$disconnect();
  await base.$disconnect();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
