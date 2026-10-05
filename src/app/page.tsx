import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/constants";
import { householdHasGateway } from "@/server/setup-entry";

export const dynamic = "force-dynamic";

export default async function Home() {
  // A household with no gateway yet starts with first-time setup, signed in or not.
  // If the database cannot answer, carry on to sign-in, which reports the problem.
  if (!(await householdHasGateway().catch(() => true))) redirect("/setup");
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  redirect(session ? "/family" : "/login");
}
