import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { Logo } from "@/components/ui/Logo";
import { appVersionLabel } from "@/lib/version";
import { DEMO_SIGN_IN_NOTE, DEMO_USERNAME } from "@/lib/demo";
import { demoModeEnabled, recoveryPassword } from "@/server/env";
import { householdHasGateway } from "@/server/setup-entry";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // A new install signs its first admin in through setup, which hands over the admin password.
  // If the database cannot answer, the form still shows, so sign-in reports the problem.
  const demo = demoModeEnabled();
  const configured = demo || (await householdHasGateway().catch(() => true));
  if (!configured) redirect("/setup");
  // The public demo shows its one shared login to every visitor; settings and passwords are locked there.
  const demoLogin = demo ? { username: DEMO_USERNAME, password: recoveryPassword() } : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        {/*
          The full signature, not the rail's condensed one: this is the only screen a
          household sees before it is signed in, and the mark is the whole of it.
        */}
        <h1 className="m-0 flex justify-center">
          <Logo variant="stacked" size="md" />
        </h1>
        <p className="text-center text-[14px] leading-5 text-[var(--ff-muted)]">
          Sign in to manage the household.
        </p>
        <SignInForm demoLogin={demoLogin} />
        {demoLogin ? (
          <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
            Username <span className="font-semibold text-[var(--ff-ink)]">{demoLogin.username}</span>, password{" "}
            <span className="whitespace-nowrap font-mono font-semibold text-[var(--ff-ink)]">{demoLogin.password}</span>. {DEMO_SIGN_IN_NOTE}
          </p>
        ) : (
          <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
            Use username <span className="font-semibold text-[var(--ff-ink)]">admin</span> with the
            recovery password from the FamilyFi server log, or a personal adult account. Only adults
            marked as admins can sign in.
          </p>
        )}
        <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
          {appVersionLabel()} · sessions last 30 days on this browser
        </p>
      </div>
    </main>
  );
}
