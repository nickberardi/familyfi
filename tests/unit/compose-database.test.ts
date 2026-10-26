import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

/**
 * The household database holds password hashes, the encrypted UniFi key and session hashes. The app
 * reaches it inside the Compose network, so its host port is for the operator's own tools on that
 * machine, never for the rest of the network.
 */
const FILES = ["docker-compose.yml", "docker-compose.dev-db.yml"];

describe("the database port in the Compose files", () => {
  it.each(FILES)("%s publishes PostgreSQL on the loopback address only", (file) => {
    const compose = YAML.parse(readFileSync(path.resolve(__dirname, "../../docker", file), "utf8")) as {
      services: Record<string, { ports?: unknown[] }>;
    };
    const ports = (compose.services.db.ports ?? []).map(String);
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port.startsWith("127.0.0.1:"), port).toBe(true);
  });
});
