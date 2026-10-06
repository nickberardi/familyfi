"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Wordmark } from "@/components/ui/Logo";
import { RECOVERY_USERNAME } from "@/lib/constants";
import { SETUP_LEDES, SETUP_STEP_COUNT, setupFoot } from "@/lib/setup";

export const TITLE =
  "m-0 text-[17px] font-semibold tracking-tight text-[var(--ff-ink)]";
export const BODY = "m-0 text-[14px] leading-[1.5] text-[var(--ff-muted)]";
export const ROW_RULE = "border-t border-[var(--ff-hairline)] first:border-t-0";
export const CHECKBOX = "h-4 w-4 flex-none accent-[var(--ff-accent)]";

/**
 * What every setup step shares: the wordmark and lede, the progress bar, the step's card with its
 * error and buttons, and the note under it.
 */
export function SetupFrame({
  step,
  error,
  pending,
  cta,
  disabled = false,
  onBack,
  onNext,
  children,
}: {
  step: number;
  error: string;
  pending: boolean;
  cta: string;
  disabled?: boolean;
  /** Absent where there is nothing to go back to. */
  onBack?: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ff-page)] px-4 py-10 md:px-6">
      <div className="flex w-full max-w-[460px] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 flex">
            {/* The wordmark is decorative, so the heading carries the name. */}
            <Wordmark size={26} />
            <span className="sr-only">FamilyFi</span>
          </h1>
          <p className={BODY}>{SETUP_LEDES[step]}</p>
        </div>

        {step < SETUP_STEP_COUNT ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-5 gap-1" aria-hidden>
              {Array.from({ length: SETUP_STEP_COUNT }, (_, index) => (
                <div
                  key={index}
                  className="h-1 rounded-sm"
                  style={{
                    background:
                      index <= step
                        ? "var(--ff-accent)"
                        : "var(--ff-hairline-strong)",
                  }}
                />
              ))}
            </div>
            <p className="m-0 text-[14px] font-semibold text-[var(--ff-muted)]">
              Step {step + 1} of {SETUP_STEP_COUNT}
            </p>
          </div>
        ) : null}

        <section
          aria-labelledby="setup-step-title"
          className="flex flex-col gap-3.5 rounded-[14px] border border-[var(--ff-line)] bg-[var(--ff-card)] p-5"
        >
          {children}

          {error ? (
            <p
              role="alert"
              className="m-0 rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2.5 text-[14px] leading-[1.45] text-[var(--ff-danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex gap-2.5">
            {onBack ? (
              <button
                type="button"
                disabled={pending}
                onClick={onBack}
                className="flex-1 rounded-[9px] border border-[var(--ff-line)] py-2.5 text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending || disabled}
              onClick={onNext}
              className="flex-[2] rounded-[9px] bg-[var(--ff-accent)] py-2.5 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40"
            >
              {pending ? "Saving…" : cta}
            </button>
          </div>
        </section>

        <p className={BODY}>{setupFoot(step)}</p>
      </div>
    </main>
  );
}

const PASSWORD_WHERE =
  "This is FAMILYFI_DEFAULT_PASSWORD in the server’s .env file. FamilyFi also prints it in the server log each time it starts.";

/**
 * The first step: the built-in admin sign-in. A new install shows its password masked, to copy;
 * once the household is set up the page no longer carries it, and only says where it is kept.
 */
export function AdminSignInStep({
  password,
  wrote,
  onWrote,
}: {
  password: string | null;
  wrote: boolean;
  onWrote: () => void;
}) {
  return (
    <>
      <h2 id="setup-step-title" className={TITLE}>
        Save your admin sign-in
      </h2>
      <p className={BODY}>
        This is the built-in admin account. Keep its password somewhere safe;
        it’s how you get back in if every other admin is locked out.
      </p>
      <div className="flex flex-col rounded-[10px] bg-[var(--ff-field)]">
        <div className={`flex items-center gap-3 px-3.5 py-2.5 ${ROW_RULE}`}>
          <span className="w-[90px] flex-none text-[14px] font-semibold text-[var(--ff-muted)]">
            Username
          </span>
          <span className="flex-1 font-mono text-[14px] text-[var(--ff-ink)]">
            {RECOVERY_USERNAME}
          </span>
        </div>
        <div className={`flex items-center gap-3 px-3.5 py-2.5 ${ROW_RULE}`}>
          <span className="flex w-[90px] flex-none items-center gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
            Password
            <WhereInfo text={PASSWORD_WHERE} />
          </span>
          {password ? (
            <PasswordCopy value={password} />
          ) : (
            <span className="flex-1 text-[14px] text-[var(--ff-ink)]">
              Kept on the server
            </span>
          )}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[var(--ff-ink)]">
        <input
          type="checkbox"
          className={CHECKBOX}
          checked={wrote}
          onChange={onWrote}
        />
        I’ve saved this password
      </label>
    </>
  );
}

/**
 * Copies with the clipboard API where the browser offers it, which is only over HTTPS or on
 * localhost. A home server opened at http://192.168.x.x has none, so it falls back to the older
 * copy command.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Refused; try the older way.
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** The password, masked, with Copy. Where nothing can copy, the password is shown to select instead. */
function PasswordCopy({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "shown">("idle");
  if (state === "shown") {
    return (
      <span className="min-w-0 flex-1 select-all break-all font-mono text-[14px] text-[var(--ff-ink)]">{value}</span>
    );
  }
  return (
    <>
      {/* The mask gives way on a narrow screen, so Copy stays inside the row at its right edge. */}
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-mono text-[14px] tracking-[0.08em] text-[var(--ff-ink)]">
        <span aria-hidden>••••••••••</span>
        <span className="sr-only">Hidden</span>
      </span>
      <button
        type="button"
        className="ml-auto flex flex-none items-center gap-1.5 rounded-lg px-1.5 py-1 text-[14px] font-semibold text-[var(--ff-accent)]"
        onClick={() => {
          void copyText(value).then((copied) => {
            setState(copied ? "copied" : "shown");
            if (copied) setTimeout(() => setState("idle"), 1500);
          });
        }}
      >
        <Icon name="copy" size={16} />
        {/* The label is the button's name, so its change to "Copied" is what a screen reader hears. */}
        <span aria-live="polite">
          {state === "copied" ? "Copied" : "Copy"}
          <span className="sr-only"> password</span>
        </span>
      </button>
    </>
  );
}

/** An info mark that explains on hover, focus or tap; the explanation is its accessible description too. */
function WhereInfo({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Where the password is kept"
        aria-describedby={id}
        aria-expanded={open}
        className="flex rounded-full text-[var(--ff-muted)]"
        onClick={() => setOpen(!open)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Icon name="info" size={16} />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`absolute left-0 top-6 z-10 w-[260px] rounded-[9px] border border-[var(--ff-line)] bg-[var(--ff-card)] px-3 py-2.5 text-[14px] font-normal leading-[1.45] text-[var(--ff-ink)] ${
          open ? "block" : "hidden"
        }`}
        style={{ boxShadow: "var(--ff-shadow-sheet)" }}
      >
        {text}
      </span>
    </span>
  );
}
