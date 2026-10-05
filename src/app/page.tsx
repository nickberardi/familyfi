import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/constants";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) redirect("/login");
  // A household with no gateway yet starts with first-time setup.
  const household = await prisma().household.findUnique({ where: { id: "default" }, select: { unifiKeyLastFour: true } });
  redirect(household?.unifiKeyLastFour ? "/family" : "/setup");
}
