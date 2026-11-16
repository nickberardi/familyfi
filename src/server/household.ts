import type { Household } from "@prisma/client";
import { prisma } from "./db";

/** The one household this deployment serves. */
export function loadHousehold(): Promise<Household> {
  return prisma().household.findUniqueOrThrow({ where: { id: "default" } });
}
