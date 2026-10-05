import { prisma } from "./db";

/** Whether the household has saved a gateway key; until it has, first-time setup is open before sign-in. */
export async function householdHasGateway(): Promise<boolean> {
  const household = await prisma().household.findUnique({ where: { id: "default" }, select: { unifiKeyLastFour: true } });
  return Boolean(household?.unifiKeyLastFour);
}
