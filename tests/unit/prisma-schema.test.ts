import { describe, expect, it } from "vitest";
import { assertPrismaClientMatchesSchema, SchemaMismatchError } from "@/server/db";
import { missingClientFields, modelFieldsFromPrismaSchema } from "@/server/prisma-schema";
import { shouldPrepareDatabase } from "../../scripts/prepare-database.mjs";

describe("modelFieldsFromPrismaSchema", () => {
  const schema = `
model Household {
  id String @id
  timezone String
  quarantineEnforced Boolean @default(true)
  @@map("Household")
}
`;

  it("reads scalar fields including new columns", () => {
    expect(modelFieldsFromPrismaSchema(schema, "Household")).toEqual([
      "id",
      "timezone",
      "quarantineEnforced",
    ]);
  });

  it("throws when the generated client is missing a schema field", () => {
    expect(() => assertPrismaClientMatchesSchema(schema, ["id", "timezone"])).toThrow(SchemaMismatchError);
  });
});

describe("missingClientFields", () => {
  it("names fields the generated client does not have", () => {
    expect(missingClientFields(["id", "quarantineEnforced"], ["id", "timezone"])).toEqual(["quarantineEnforced"]);
  });
});

describe("shouldPrepareDatabase", () => {
  it("runs for Next and skips the spike CLI and nested prisma commands", () => {
    expect(shouldPrepareDatabase("next", ["dev"])).toBe(true);
    expect(shouldPrepareDatabase("npx", ["tsx", "scripts/spike/index.ts"])).toBe(false);
    expect(shouldPrepareDatabase("./node_modules/.bin/prisma", ["migrate", "deploy"])).toBe(false);
  });
});
