/**
 * Serves one PGlite database over the PostgreSQL wire protocol, for demo mode (demo.mjs). PGlite is
 * a single session, so this does what a server's backends would: it runs one request at a time, and
 * while a connection holds a transaction open, only that connection's requests run.
 *
 * Why not `@electric-sql/pglite-socket`: it hands PGlite one protocol message at a time, and after an
 * error inside a transaction (a unique violation, say) PGlite's answers to the rest of that request
 * then reach the client out of step, so every later query on the connection reads the wrong result.
 * Here a request is everything up to its Sync, simple Query or Flush, and PGlite gets it whole.
 *
 * Unlike PostgreSQL, a query from another connection waits while a transaction is open, so code that
 * queried outside its own interactive transaction would wait for Prisma's transaction timeout here.
 */
import net from "node:net";

const SSL_REQUEST = 80877103;
const GSS_REQUEST = 80877104;
const CANCEL_REQUEST = 80877102;
/** Message types that end a request: Sync, Query, Flush. Terminate closes the connection. */
const SYNC = 0x53;
const QUERY = 0x51;
const FLUSH = 0x48;
const TERMINATE = 0x58;

/**
 * Listens on `host:port` (0 picks a free port) and resolves once listening, with the port and a
 * `close` that stops accepting and ends every connection.
 * @param {import("@electric-sql/pglite").PGlite} db
 * @param {{ host: string, port: number }} address
 */
export function servePGlite(db, { host, port }) {
  /** @type {{ socket: net.Socket, request: Buffer }[]} */
  const queue = [];
  /** The connection whose transaction is open, which alone may run until it ends. */
  let owner = null;
  let running = false;
  const sockets = new Set();

  async function drain() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const index = owner ? queue.findIndex((item) => item.socket === owner) : 0;
        if (index < 0 || !queue.length) return;
        const [{ socket, request }] = queue.splice(index, 1);
        if (socket.destroyed) continue;
        try {
          const reply = await db.runExclusive(() => db.execProtocolRaw(request));
          owner = db.isInTransaction() ? socket : null;
          if (reply.length && !socket.destroyed) socket.write(reply);
        } catch (error) {
          // PGlite answers SQL errors in the protocol; a throw means this connection's session is unusable.
          console.error("demo database:", error);
          owner = db.isInTransaction() ? socket : null;
          socket.destroy(); // its close rolls back any transaction it left open
        }
      }
    } finally {
      running = false;
    }
  }

  function enqueue(socket, request) {
    queue.push({ socket, request });
    void drain();
  }

  /** A connection that leaves mid-transaction must not keep the database for itself. */
  async function release(socket) {
    sockets.delete(socket);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].socket === socket) queue.splice(i, 1);
    if (owner !== socket) return;
    await db.exec("ROLLBACK").catch(() => {}); // exec takes PGlite's own lock
    owner = null;
    void drain();
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let started = false;
    /** @type {Buffer[]} */
    let pending = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          // Startup-phase messages carry no type byte: a length, then a code or protocol version.
          if (buffer.length < 8) return;
          const length = buffer.readUInt32BE(0);
          if (length < 8) {
            socket.destroy();
            return;
          }
          if (buffer.length < length) return;
          const message = buffer.subarray(0, length);
          buffer = buffer.subarray(length);
          const code = message.readUInt32BE(4);
          if (code === SSL_REQUEST || code === GSS_REQUEST) {
            socket.write("N"); // Loopback only: no TLS, no GSSAPI.
            continue;
          }
          if (code === CANCEL_REQUEST) {
            socket.end();
            return;
          }
          started = true;
          enqueue(socket, message);
          continue;
        }
        if (buffer.length < 5) return;
        const length = buffer.readUInt32BE(1) + 1;
        if (length < 5) {
          socket.destroy();
          return;
        }
        if (buffer.length < length) return;
        const message = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        if (message[0] === TERMINATE) {
          socket.end();
          return;
        }
        pending.push(message);
        if (message[0] === SYNC || message[0] === QUERY || message[0] === FLUSH) {
          enqueue(socket, Buffer.concat(pending));
          pending = [];
        }
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => void release(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
