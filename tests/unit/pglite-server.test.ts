import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { startMemoryDatabase } from "../../scripts/runtime/memory-database.mjs";

/** The in-memory database's server (`scripts/runtime/pglite-server.mjs`), spoken to by `pg` as Prisma's adapter does. */
let database: { port: number; stop: () => Promise<void> };
const clients: pg.Client[] = [];

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ host: "127.0.0.1", port: database.port, user: "postgres", password: "postgres", database: "template1", ssl: false });
  await client.connect();
  clients.push(client);
  return client;
}

// Starting PGlite loads its WASM, which takes longer than the 10 s default under CI's coverage run.
beforeAll(async () => {
  database = await startMemoryDatabase({ port: 0 });
  const client = await connect();
  await client.query("CREATE TABLE item (id int PRIMARY KEY, name text UNIQUE)");
  await client.query("INSERT INTO item VALUES (1, 'a'), (2, 'b')");
}, 60_000);

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => {})));
  await database?.stop();
});

describe("demo database server", () => {
  it("keeps a connection's answers in step after an error inside a transaction", async () => {
    const client = await connect();
    await client.query("BEGIN");
    await client.query("DELETE FROM item WHERE id = $1", [99]);
    await expect(client.query("UPDATE item SET name = $1 WHERE id = $2 RETURNING *", ["a", 2])).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK");
    expect((await client.query("SELECT $1::int AS n", [42])).rows).toEqual([{ n: 42 }]);
  });

  it("runs only the transaction's connection while its transaction is open", async () => {
    const [writer, reader] = [await connect(), await connect()];
    await writer.query("BEGIN");
    await writer.query("UPDATE item SET name = 'changed' WHERE id = 1");
    let read: string | undefined;
    const reading = reader.query("SELECT name FROM item WHERE id = 1").then((result) => (read = result.rows[0].name));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read).toBeUndefined(); // waits: running now would put it inside the writer's transaction
    await writer.query("ROLLBACK");
    await reading;
    expect(read).toBe("a");
  });

  it("rolls back a transaction whose connection leaves, so the others carry on", async () => {
    const [leaver, other] = [await connect(), await connect()];
    await leaver.query("BEGIN");
    await leaver.query("UPDATE item SET name = 'gone' WHERE id = 2");
    await leaver.end();
    expect((await other.query("SELECT name FROM item WHERE id = 2")).rows).toEqual([{ name: "b" }]);
  });
});
