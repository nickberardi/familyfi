import { describe, expect, it } from "vitest";
import { buildDatabaseUrl } from "@/server/database-url";

describe("buildDatabaseUrl", () => {
  it("percent-encodes credentials", () => {
    const url = buildDatabaseUrl({
      DB_HOST: "db.internal",
      DB_PORT: "5432",
      DB_NAME: "family fi",
      DB_USER: "fam@ily",
      DB_PASSWORD: "p@ss/w:rd",
    });
    expect(url).toBe(
      "postgresql://fam%40ily:p%40ss%2Fw%3Ard@db.internal:5432/family%20fi",
    );
  });

  it("appends ssl settings", () => {
    const url = buildDatabaseUrl({
      DB_HOST: "db.example",
      DB_PASSWORD: "x",
      DB_SSL_MODE: "require",
      DB_SSL_ROOT_CERT: "/certs/ca.pem",
    });
    expect(url).toContain("sslmode=require");
    expect(url).toContain("sslrootcert=%2Fcerts%2Fca.pem");
  });
});
