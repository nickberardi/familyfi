"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { homeOrigin } from "@/lib/connection-routes";
import { FIELD, PRIMARY_BUTTON } from "./SheetFrame";

/**
 * The home network address: where FamilyFi is inside the home, kept apart from Remote access, the
 * route phones use from outside. Agents pair here, so a proxy's sign-in page never stands in their way.
 */
export function HomeAddressCard() {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ home: { url: string | null } }>("/api/v1/connection/home")
      .then(({ home }) => {
        setSaved(home.url);
        setValue(home.url ?? "");
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not load the home network address."));
  }, []);

  async function save(url: string | null) {
    setBusy(true);
    setError("");
    try {
      const { home } = await api<{ home: { url: string | null } }>("/api/v1/connection/home", { method: "PUT", body: JSON.stringify({ url }) });
      setSaved(home.url);
      setValue(home.url ?? "");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the home network address.");
    } finally {
      setBusy(false);
    }
  }

  const trimmed = value.trim();
  const valid = trimmed === "" || homeOrigin(trimmed) !== null;
  const changed = saved !== undefined && trimmed !== (saved ?? "");

  return (
    <section data-testid="home-address" className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <div className="text-[14px] font-semibold">Home network address</div>
        <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
          Where FamilyFi is on your home network, such as http://192.168.1.10:7001. AI agents connect here. Without one, they use the
          address you opened FamilyFi at, which fails if it asks for a sign-in such as Cloudflare Access.
        </div>
      </div>
      <form
        className="flex flex-col gap-2 px-[18px] py-3 text-[14px] leading-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save(trimmed === "" ? null : trimmed);
        }}
      >
        <label className="font-semibold text-[var(--ff-muted)]">
          Address
          <input
            className={`${FIELD} font-mono`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="http://192.168.1.10:7001"
            autoComplete="off"
            spellCheck={false}
            disabled={saved === undefined || busy}
          />
        </label>
        {!valid ? <p className="text-[var(--ff-muted)]">Use an http or https address with no path.</p> : null}
        {error ? (
          <p role="alert" className="font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}
        <div>
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy || !changed || !valid}>
            {trimmed === "" && saved ? "Clear" : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}
