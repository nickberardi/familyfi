import { defineConfig } from "prisma/config";
import { applyDatabaseUrl } from "./scripts/print-database-url.mjs";

applyDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://familyfi:familyfi@127.0.0.1:5432/familyfi",
  },
});
