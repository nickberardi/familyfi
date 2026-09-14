import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  redirect(session ? "/family" : "/login");
}
