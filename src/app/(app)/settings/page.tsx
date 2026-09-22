"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { consoleHostFromBaseUrl, localIntegrationBaseFromHost } from "@/lib/unifi-host";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { initials } from "@/lib/display";
import {
  gatewayFacts,
  householdMemberNote,
  keyState,
  usernameFromName,
} from "@/lib/settings-copy";
import { relativeSweep } from "@/lib/sync-copy";
import type { Group, UpdateCheck } from "@/lib/types";
import { appVersionLabel } from "@/lib/version";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Europe/London",
  "Europe/Paris",
  "UTC",
];

const FIELD = "mt-1 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]";
const ROLES = ["child", "teen", "adult"] as const;

function UpdateSummary({ update, loadError }: { update: UpdateCheck | null; loadError: boolean }) {
  if (loadError || update?.status === "error") {
    return <span className="text-[14px] font-semibold text-[var(--ff-danger)]">Update check unavailable</span>;
  }
  if (!update || update.status === "pending") {
    return <span className="text-[14px] text-[var(--ff-muted)]">Checking for updates…</span>;
  }
  if (update.available && update.latestVersion && update.releaseUrl) {
    return (
      <span className="text-[14px] font-semibold text-[var(--ff-accent)]">
        Update available: {appVersionLabel(update.latestVersion)} · {" "}
        <a href={update.releaseUrl} target="_blank" rel="noreferrer" className="underline">
          View release
        </a>
      </span>
    );
  }
  if (!update.latestVersion) return <span className="text-[14px] text-[var(--ff-muted)]">No published release found</span>;
  return <span className="text-[14px] font-semibold text-[var(--ff-on-ink)]">Up to date</span>;
}

export default function SettingsPage() {
  const { unifi, household, accounts, groups, sync, mutate } = useAppData();
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [apiKey, setApiKey] = useState("");
  const [consoleHost, setConsoleHost] = useState("");
  const [consoleId, setConsoleId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [tlsInsecure, setTlsInsecure] = useState(true);
  const [manageAll, setManageAll] = useState(false);
  const [managedIds, setManagedIds] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("America/New_York");
  const [probe, setProbe] = useState("");
  const [pasting, setPasting] = useState(false);
  const [editingGateway, setEditingGateway] = useState(false);
  const [newName, setNewName] = useState("");
  const [loginFor, setLoginFor] = useState<Group | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const [unifiStamp, setUnifiStamp] = useState<string | null>(null);
  const [timezoneStamp, setTimezoneStamp] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateLoadError, setUpdateLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let nextDelay = 60_000;
      try {
        const result = await api<{ update: UpdateCheck }>("/api/v1/health");
        if (cancelled) return;
        setUpdate(result.update);
        setUpdateLoadError(false);
        if (result.update.status === "pending") nextDelay = 5_000;
      } catch {
        if (cancelled) return;
        setUpdateLoadError(true);
      }
      if (!cancelled) timer = setTimeout(() => void poll(), nextDelay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const family = groups.filter((group) => group.kind === "family");
  const personal = accounts.filter((account) => !account.recovery);
  const recovery = accounts.find((account) => account.recovery);
  const state = keyState(unifi);
  const facts = gatewayFacts(unifi);
  const lastCall = sync?.lastRun?.finishedAt ?? sync?.lastRun?.startedAt ?? null;
  const nextUnifiStamp = unifi
    ? [
        unifi.configured,
        unifi.consoleId ?? "",
        unifi.baseUrl ?? "",
        unifi.siteId ?? "",
        unifi.tlsInsecure,
        unifi.manageAllNetworks,
        unifi.managedNetworkIds.join(","),
      ].join("|")
    : null;
  if (nextUnifiStamp && nextUnifiStamp !== unifiStamp) {
    setUnifiStamp(nextUnifiStamp);
    setMode(unifi?.consoleId ? "cloud" : "local");
    setConsoleHost(consoleHostFromBaseUrl(unifi?.baseUrl ?? null));
    setConsoleId(unifi?.consoleId ?? "");
    setSiteId(unifi?.siteId ?? "");
    setTlsInsecure(unifi?.tlsInsecure ?? true);
    setManageAll(unifi?.manageAllNetworks ?? false);
    setManagedIds(unifi?.managedNetworkIds ?? []);
    if (unifi && !unifi.configured) {
      setPasting(true);
      setEditingGateway(true);
    }
  }
  if (household && household.timezone !== timezoneStamp) {
    setTimezoneStamp(household.timezone);
    setTimezone(household.timezone);
  }

  function targetBody() {
    return mode === "local"
      ? { baseUrl: localIntegrationBaseFromHost(consoleHost), siteId: siteId || undefined, tlsInsecure }
      : { consoleId, siteId: siteId || undefined, tlsInsecure };
  }

  async function testConnection(event?: FormEvent) {
    event?.preventDefault();
    setProbe("");
    try {
      const body = pasting && apiKey.length >= 8 ? { apiKey, ...targetBody() } : {};
      const result = await api<{ applicationVersion: string; site: { name: string }; networks: { name: string }[] }>(
        "/api/v1/settings/unifi/test",
        { method: "POST", body: JSON.stringify(body) },
      );
      setProbe(`Reachable · Network ${result.applicationVersion} · site ${result.site.name} · ${result.networks.length} networks`);
    } catch (error) {
      setProbe(error instanceof Error ? error.message : "Probe failed.");
    }
  }

  function saveKey() {
    setProbe("");
    try {
      const body = { apiKey, ...targetBody(), manageAllNetworks: manageAll, managedNetworkIds: managedIds };
      void mutate(async () => {
        const result = await api<{ change: { changeId: string } }>("/api/v1/settings/unifi", { method: "PUT", body: JSON.stringify(body) });
        setPasting(false);
        setApiKey("");
        return result;
      });
    } catch (error) {
      setProbe(error instanceof Error ? error.message : "Could not save UniFi settings.");
    }
  }

  const pwHint =
    pw1.length < 8 ? "At least 8 characters." : pw1 !== pw2 ? "The two passwords must match." : "Looks good — this login is only for FamilyFi.";

  return (
    <>
      <PageHeader title="Settings" sub="Gateway connection, credentials, and household roles." />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-2">
          <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
            <div className="border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px] text-[14px] font-semibold">Gateway</div>
            {facts.map((fact, index) => (
              <div
                key={fact.k}
                className="flex items-center gap-3 px-[18px] py-2.5"
                style={{ borderTop: index ? "1px solid var(--ff-hairline)" : undefined }}
              >
                <div className="w-[130px] flex-none text-[14px] text-[var(--ff-muted)]">{fact.k}</div>
                <div className="min-w-0 flex-1 text-right font-mono text-[14px]">{fact.v}</div>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3">
              <label className="min-w-[220px] flex-1 text-[14px] font-semibold text-[var(--ff-muted)]">
                Timezone
                <input list="ff-tz" className={FIELD} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                <datalist id="ff-tz">
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </label>
              <button
                type="button"
                className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
                onClick={() =>
                  void mutate(() =>
                    api("/api/v1/settings/household", { method: "PUT", body: JSON.stringify({ timezone }) }),
                  )
                }
              >
                Save timezone
              </button>
            </div>
            {editingGateway ? (
              <form className="flex flex-col gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-4" onSubmit={(event) => void testConnection(event)}>
                <div className="flex gap-3 text-[14px]">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={mode === "local"} onChange={() => setMode("local")} />
                    Local console
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={mode === "cloud"} onChange={() => setMode("cloud")} />
                    Cloud console ID
                  </label>
                </div>
                {mode === "local" ? (
                  <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
                    Console IP
                    <input className={FIELD} value={consoleHost} onChange={(e) => setConsoleHost(e.target.value)} autoComplete="off" placeholder="10.1.2.1" />
                    <span className="mt-1 block font-normal">
                      FamilyFi talks to https://{consoleHost.trim() || "…"}/proxy/network/integration
                    </span>
                  </label>
                ) : (
                  <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
                    Console ID
                    <input className={FIELD} value={consoleId} onChange={(e) => setConsoleId(e.target.value)} />
                  </label>
                )}
                <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
                  Site ID (optional)
                  <input className={FIELD} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
                </label>
                <label className="flex items-center gap-2 text-[14px] font-normal text-[var(--ff-ink)]">
                  <input type="checkbox" checked={tlsInsecure} onChange={(e) => setTlsInsecure(e.target.checked)} />
                  Allow self-signed TLS (local consoles)
                </label>
                <p className="text-[14px] text-[var(--ff-muted)]">
                  Discovery and quarantine only watch selected UniFi networks. Host and TLS are stored when you save an API
                  key.
                </p>
                <label className="flex items-center gap-2 text-[14px]">
                  <input type="checkbox" checked={manageAll} onChange={(e) => setManageAll(e.target.checked)} />
                  Watch every network on the site
                </label>
                {(unifi?.networks ?? []).length === 0 ? (
                  <p className="text-[14px] text-[var(--ff-muted)]">Save a working UniFi connection to list VLANs.</p>
                ) : (
                  unifi?.networks.map((network) => (
                    <label key={network.id} className="flex items-center gap-2 text-[14px]">
                      <input
                        type="checkbox"
                        disabled={manageAll}
                        checked={manageAll || managedIds.includes(network.id)}
                        onChange={(event) => {
                          setManagedIds((current) =>
                            event.target.checked ? [...current, network.id] : current.filter((id) => id !== network.id),
                          );
                        }}
                      />
                      {network.name} · VLAN {network.vlanId}
                    </label>
                  ))
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
                    onClick={() =>
                      void mutate(() =>
                        api("/api/v1/settings/unifi", {
                          method: "PUT",
                          body: JSON.stringify({ manageAllNetworks: manageAll, managedNetworkIds: managedIds }),
                        }),
                      )
                    }
                  >
                    Save network selection
                  </button>
                  {unifi?.configured ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--ff-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-muted)]"
                      onClick={() => setEditingGateway(false)}
                    >
                      Done
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="border-t border-[var(--ff-hairline)] px-[18px] py-3">
                <button
                  type="button"
                  className="text-[14px] font-semibold text-[var(--ff-accent)]"
                  onClick={() => setEditingGateway(true)}
                >
                  Edit connection
                </button>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
            <div className="border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px] text-[14px] font-semibold">UniFi API key</div>
            <div className="px-[18px] py-4">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <div className="font-mono text-[14px]">{unifi?.apiKeyMasked ?? "No key saved"}</div>
                <div className="rounded-full px-2 py-0.5 text-[14px] font-semibold" style={{ background: state.bg, color: state.ink }}>
                  {state.label}
                </div>
              </div>
              <p className="mt-1.5 text-[14px] leading-5 text-[var(--ff-muted)]">
                {unifi?.connectionError
                  ? unifi.connectionError
                  : lastCall
                    ? `Last sweep ${relativeSweep(lastCall)}`
                    : "Save a key to start discovery and quarantine."}
              </p>
              <p className="mt-3 rounded-[9px] bg-[var(--ff-note-fill)] px-3 py-2.5 text-[14px] leading-5 text-[var(--ff-muted)]">
                FamilyFi can&rsquo;t issue or rotate this key — only a UniFi console admin can. Create one in your UniFi
                console, then paste it here. Revoking the old key in UniFi is what actually retires it.
              </p>
              {pasting ? (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    className={FIELD}
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste the key from your UniFi console"
                  />
                  <p className="text-[14px]" style={{ color: apiKey.trim().length >= 8 ? "var(--ff-on)" : "var(--ff-muted)" }}>
                    {apiKey.trim().length < 8
                      ? "Paste the Network Integration API key, then save to test it against this gateway."
                      : `Looks like a key — saving will test it before it ${unifi?.configured ? "replaces the old one" : "is stored"}.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={apiKey.length < 8}
                      className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40"
                      onClick={saveKey}
                    >
                      Save and test
                    </button>
                    {unifi?.configured ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--ff-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-muted)]"
                        onClick={() => {
                          setPasting(false);
                          setApiKey("");
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
                    onClick={() => {
                      setPasting(true);
                      setApiKey("");
                    }}
                  >
                    Replace key
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--ff-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-accent)]"
                    onClick={() => void testConnection()}
                  >
                    Test connection
                  </button>
                </div>
              )}
              {probe ? <p className="mt-2.5 text-[14px]">{probe}</p> : null}
              <p className="mt-2.5 text-[14px] leading-5 text-[var(--ff-muted)]">
                Stored encrypted · every UniFi call is made server-side, never from this browser.
              </p>
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
          <div className="flex flex-wrap items-baseline gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
            <span className="text-[14px] font-semibold">Household</span>
            <span className="text-[14px] text-[var(--ff-muted)]">
              Children and teens get pause and schedules · adults can be admins with their own login
            </span>
          </div>
          {recovery ? (
            <div className="flex items-center gap-3 px-[18px] py-3">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--ff-mark)] text-[14px] font-semibold text-[var(--ff-ink-on-fill)]">
                {initials(recovery.displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{recovery.displayName}</div>
                <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
                  Recovery admin · username {recovery.username} · password is FAMILYFI_DEFAULT_PASSWORD on the server
                </div>
              </div>
            </div>
          ) : null}
          {family.map((group) => {
            const account = personal.find((item) => item.groupId === group.id);
            const adult = group.familyRole === "adult";
            const lockedRole = Boolean(account);
            return (
              <div
                key={group.id}
                className="flex flex-wrap items-center gap-3 px-[18px] py-3"
                style={{ borderTop: "1px solid var(--ff-hairline)" }}
              >
                <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--ff-mark)] text-[14px] font-semibold text-[var(--ff-ink-on-fill)]">
                  {group.monogram || initials(group.name)}
                </div>
                <div className="min-w-[150px] flex-1">
                  <div className="text-[14px] font-semibold">{group.name}</div>
                  <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{householdMemberNote(group, account)}</div>
                </div>
                <div className="flex flex-none gap-0.5 rounded-lg bg-[var(--ff-field)] p-0.5" role="radiogroup" aria-label={`${group.name} role`}>
                  {ROLES.map((role) => {
                    const on = group.familyRole === role;
                    const disabled = lockedRole && role !== "adult";
                    return (
                      <button
                        key={role}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled}
                        className="rounded-md px-2.5 py-1 text-[14px] capitalize disabled:opacity-40"
                        style={{
                          fontWeight: on ? 600 : 500,
                          background: on ? "var(--ff-ink-on-fill)" : "transparent",
                          color: on ? "var(--ff-ink)" : "var(--ff-muted)",
                          boxShadow: on ? "var(--ff-shadow-knob)" : "none",
                        }}
                        onClick={() => {
                          if (on || disabled) return;
                          void mutate(() =>
                            api(`/api/v1/groups/${group.id}`, { method: "PUT", body: JSON.stringify({ familyRole: role }) }),
                          );
                        }}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
                {adult ? (
                  <button
                    type="button"
                    className="flex flex-none items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[14px] font-semibold"
                    style={{
                      borderColor: account?.isAdmin ? "var(--ff-accent-line)" : "var(--ff-control-line)",
                      background: account?.isAdmin ? "var(--ff-accent-wash)" : "var(--ff-ink-on-fill)",
                      color: account?.isAdmin ? "var(--ff-accent)" : "var(--ff-muted)",
                    }}
                    onClick={() => {
                      if (!account) {
                        setLoginFor(group);
                        setLoginUser(usernameFromName(group.name));
                        setPw1("");
                        setPw2("");
                        return;
                      }
                      void mutate(() =>
                        api(`/api/v1/accounts/${account.id}`, {
                          method: "PUT",
                          body: JSON.stringify({ isAdmin: !account.isAdmin }),
                        }),
                      );
                    }}
                  >
                    <span
                      className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border text-[10px] leading-none text-[var(--ff-ink-on-fill)]"
                      style={{
                        borderColor: account?.isAdmin ? "var(--ff-accent)" : "var(--ff-disabled)",
                        background: account?.isAdmin ? "var(--ff-accent)" : "var(--ff-ink-on-fill)",
                      }}
                    >
                      {account?.isAdmin ? "✓" : ""}
                    </span>
                    Admin
                  </button>
                ) : null}
                {account ? (
                  <button
                    type="button"
                    className="text-[14px] font-semibold text-[var(--ff-danger)]"
                    onClick={() => void mutate(() => api(`/api/v1/accounts/${account.id}`, { method: "DELETE" }))}
                  >
                    Remove login
                  </button>
                ) : null}
              </div>
            );
          })}
          <form
            className="flex items-center gap-2.5 border-t border-[var(--ff-hairline)] px-[18px] py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newName.trim();
              if (!name) return;
              void mutate(async () => {
                const result = await api<{ change: { changeId: string } }>("/api/v1/groups", {
                  method: "POST",
                  body: JSON.stringify({ kind: "family", name, familyRole: "child" }),
                });
                setNewName("");
                return result;
              });
            }}
          >
            <input
              className={`${FIELD} mt-0 flex-1`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add a family member"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
          <div className="border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px] text-[14px] font-semibold">About</div>
          <div className="flex items-center gap-3 px-[18px] py-2.5">
            <div className="w-[130px] flex-none text-[14px] text-[var(--ff-muted)]">Version</div>
            <div className="min-w-0 flex-1 text-right font-mono text-[14px]">{appVersionLabel()}</div>
          </div>
          <div
            className="flex items-center gap-3 px-[18px] py-2.5"
            style={{ borderTop: "1px solid var(--ff-hairline)" }}
          >
            <div className="w-[130px] flex-none text-[14px] text-[var(--ff-muted)]">Updates</div>
            <div className="min-w-0 flex-1 text-right">
              <UpdateSummary update={update} loadError={updateLoadError} />
            </div>
          </div>
          <div
            className="flex items-center gap-3 px-[18px] py-2.5"
            style={{ borderTop: "1px solid var(--ff-hairline)" }}
          >
            <div className="w-[130px] flex-none text-[14px] text-[var(--ff-muted)]">License</div>
            <div className="min-w-0 flex-1 text-right text-[14px]">Business Source License 1.1</div>
          </div>
          <p className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] leading-5 text-[var(--ff-muted)]">
            FamilyFi {appVersionLabel()}. One household UniFi network. Report bugs on GitHub with credentials and IPs
            removed.
          </p>
        </section>
      </div>

      {loginFor ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--ff-scrim)] p-6">
          <div className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-[var(--ff-card)] shadow-[var(--ff-shadow-sheet)]">
            <div className="px-[18px] pt-[18px] pb-1">
              <div className="text-[17px] font-bold tracking-tight">Create login for {loginFor.name}</div>
              <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">
                This password unlocks FamilyFi only — the gateway keeps its own credentials.
              </p>
            </div>
            <div className="flex flex-col gap-3 px-[18px] py-3.5">
              <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
                Username
                <input className={FIELD} value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="off" />
              </label>
              <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
                Password
                <input className={FIELD} type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="At least 8 characters" />
              </label>
              <label className="text-[14px] font-semibold text-[var(--ff-muted)]">
                Confirm password
                <input className={FIELD} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Type it again" />
              </label>
              <p className="text-[14px]" style={{ color: pw1.length >= 8 && pw1 === pw2 ? "var(--ff-on)" : "var(--ff-muted)" }}>
                {pwHint}
              </p>
            </div>
            <div className="flex border-t border-[var(--ff-hairline-card)]">
              <button
                type="button"
                className="flex-1 py-3 text-center text-[14px] text-[var(--ff-muted)]"
                onClick={() => setLoginFor(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pw1.length < 8 || pw1 !== pw2 || loginUser.trim().length < 2}
                className="flex-1 border-l border-[var(--ff-hairline-card)] py-3 text-center text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40"
                onClick={() => {
                  const group = loginFor;
                  void mutate(async () => {
                    const result = await api<{ change: { changeId: string } }>("/api/v1/accounts", {
                      method: "POST",
                      body: JSON.stringify({
                        username: loginUser.trim(),
                        displayName: group.name,
                        password: pw1,
                        groupId: group.id,
                        isAdmin: true,
                      }),
                    });
                    setLoginFor(null);
                    return result;
                  });
                }}
              >
                Create login
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
