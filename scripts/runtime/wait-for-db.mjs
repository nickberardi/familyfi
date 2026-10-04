#!/usr/bin/env node
import net from "node:net";
import { setting } from "./mode.mjs";
import { applyDatabaseUrl } from "./print-database-url.mjs";

applyDatabaseUrl();

const host = setting(process.env, "DB_HOST") || "127.0.0.1";
const port = Number(setting(process.env, "DB_PORT") || "5432");

const socket = net.connect({ host, port });
const timer = setTimeout(() => {
  socket.destroy();
  process.exit(1);
}, 3000);

socket.on("connect", () => {
  clearTimeout(timer);
  socket.end();
  process.exit(0);
});
socket.on("error", () => {
  clearTimeout(timer);
  process.exit(1);
});
