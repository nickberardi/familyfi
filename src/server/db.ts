import { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env";
import { missingClientFields, modelFieldsFromPrismaSchema } from "./prisma-schema";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaMismatchError";
  }
}

let schemaChecked = false;

export function assertPrismaClientMatchesSchema(
  schema = readSchema(),
  clientFieldNames = householdClientFields(),
): void {
  if (!schema) return;
  const missing = missingClientFields(modelFieldsFromPrismaSchema(schema, "Household"), clientFieldNames);
  if (missing.length) {
    throw new SchemaMismatchError(
      `Prisma client is missing Household.${missing.join(", Household.")}. Restart FamilyFi so it can regenerate the client after migrations.`,
    );
  }
}

function readSchema(): string | undefined {
  try {
    return readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  } catch {
    return undefined;
  }
}

function householdClientFields(): string[] {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === "Household");
  return model?.fields.map((field) => field.name) ?? [];
}

export function prisma(): PrismaClient {
  env();
  if (!schemaChecked) {
    assertPrismaClientMatchesSchema();
    schemaChecked = true;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}

export async function disconnectPrismaForTests() {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
  schemaChecked = false;
}
