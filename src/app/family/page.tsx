import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { readSessionFromRequest } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const session = await readSessionFromRequest(new Request("http://familyfi.local/family"));
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-6 py-10">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Family</h1>
        <p className="mt-1 text-[14px] text-[var(--ff-muted)]">
          Signed in as {session.account?.displayName ?? session.username}. Household controls land in a
          later phase; this screen confirms authentication is working.
        </p>
      </div>
      <section className="rounded-xl border border-[var(--ff-line)] bg-white p-5">
        <p className="text-[16px] font-semibold">FamilyFi is running</p>
        <p className="mt-2 text-[14px] leading-5 text-[var(--ff-muted)]">
          Configure UniFi in Settings after the backend phase. Pause suspends schedule enforcement;
          Resume restores the stored schedule.
        </p>
      </section>
      <SignOutButton />
    </main>
  );
}
