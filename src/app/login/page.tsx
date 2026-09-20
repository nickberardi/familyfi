import { SignInForm } from "@/components/SignInForm";
import { Logo } from "@/components/ui/Logo";
import { appVersionLabel } from "@/lib/version";

export const dynamic = "force-dynamic";

export default function LoginPage() {
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
        <SignInForm />
        <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
          Use username <span className="font-semibold text-[var(--ff-ink)]">admin</span> with the
          recovery password from the FamilyFi server log, or a personal adult account. Only adults
          marked as admins have logins.
        </p>
        <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
          {appVersionLabel()} · sessions last 30 days on this browser
        </p>
      </div>
    </main>
  );
}
