import { SignInForm } from "@/components/SignInForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-bold tracking-tight">FamilyFi</h1>
          <p className="text-[14px] leading-5 text-[var(--ff-muted)]">Sign in to manage the household.</p>
        </div>
        <SignInForm />
        <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
          Use username <span className="font-semibold text-[var(--ff-ink)]">admin</span> with the operator
          recovery password, or a personal adult account. Sessions last 30 days on this browser.
        </p>
      </div>
    </main>
  );
}
