"use client";

import { SETTINGS_COPY as COPY, loginFormState } from "@/lib/settings-copy";

const FIELD = "mt-1 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]";
const LABEL = "text-[14px] font-semibold text-[var(--ff-muted)]";

/** The web's new-login fields: each label wraps its input, so clicking it focuses the field. */
export function NewLoginFields({
  username,
  password,
  confirm,
  onChange,
}: {
  username: string;
  password: string;
  confirm: string;
  onChange: (field: "username" | "password" | "confirm", value: string) => void;
}) {
  const state = loginFormState(username, password, confirm);
  return (
    <div className="flex flex-col gap-3">
      <label className={LABEL}>
        {COPY.username}
        <input className={FIELD} value={username} onChange={(event) => onChange("username", event.target.value)} autoComplete="off" />
      </label>
      <label className={LABEL}>
        {COPY.password}
        <input className={FIELD} type="password" value={password} onChange={(event) => onChange("password", event.target.value)} placeholder={COPY.passwordPlaceholder} />
      </label>
      <label className={LABEL}>
        {COPY.confirmPassword}
        <input className={FIELD} type="password" value={confirm} onChange={(event) => onChange("confirm", event.target.value)} placeholder={COPY.confirmPlaceholder} />
      </label>
      <p className="text-[14px]" style={{ color: state.passwordsOk ? "var(--ff-on)" : "var(--ff-muted)" }}>
        {state.hint}
      </p>
    </div>
  );
}
