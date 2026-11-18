import { prisma } from "./db";
import { currentHouseholdId } from "./household-context";

/** Whether the household has saved a gateway key; until it has, first-time setup is open before sign-in. */
export async function householdHasGateway(): Promise<boolean> {
  const household = await prisma().household.findUnique({ where: { id: currentHouseholdId() }, select: { unifiKeyLastFour: true } });
  return Boolean(household?.unifiKeyLastFour);
}
