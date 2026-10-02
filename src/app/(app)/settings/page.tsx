"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { consoleHostFromBaseUrl, localIntegrationBaseFromHost } from "@/lib/unifi-host";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { SETTINGS_COPY, createLoginTitle, loginFormState, usernameFromName } from "@/lib/settings-copy";
import { createLogin } from "@/lib/settings-writes";
import type { Group } from "@/lib/types";
import { NewLoginFields } from "@/ui/NewLoginFields";
import { GatewayCard, HouseholdCard, KeyCard } from "@/ui/SettingsCards";

const FIELD =
  "mt-1 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)]";

export default function SettingsPage() {
  const { unifi, household, accounts, groups, sync, mutate, store } = useAppData();
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [apiKey, setApiKey] = useState("");
  const [consoleHost, setConsoleHost] = useState("");
  const [consoleId, setConsoleId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [tlsInsecure, setTlsInsecure] = useState(true);
  const [manageAll, setManageAll] = useState(false);
  const [managedIds, setManagedIds] = useState<string[]>([]);
  const [probe, setProbe] = useState("");
  const [pasting, setPasting] = useState(false);
  const [editingGateway, setEditingGateway] = useState(false);
  const [loginFor, setLoginFor] = useState<Group | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const [unifiStamp, setUnifiStamp] = useState<string | null>(null);

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
      setProbe(
        `Reachable · Network ${result.applicationVersion} · site ${result.site.name} · ${result.networks.length} networks`,
      );
    } catch (error) {
      setProbe(error instanceof Error ? error.message : "Probe failed.");
    }
  }

  function saveKey() {
    setProbe("");
    try {
      const body = { apiKey, ...targetBody(), manageAllNetworks: manageAll, managedNetworkIds: managedIds };
      void mutate(async () => {
        const result = await api<{ change: { changeId: string } }>("/api/v1/settings/unifi", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        setPasting(false);
        setApiKey("");
        return result;
      });
    } catch (error) {
      setProbe(error instanceof Error ? error.message : "Could not save UniFi settings.");
    }
  }

  const login = loginFormState(loginUser, pw1, pw2);

  return (
    <>
      <PageHeader title={SETTINGS_COPY.title} sub={SETTINGS_COPY.sub} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-2">
          <GatewayCard unifi={unifi} timezone={household?.timezone ?? "America/New_York"} mutate={store.mutate}>
            {editingGateway ? (
              <form
                className="flex flex-col gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-4"
                onSubmit={(event) => void testConnection(event)}
              >
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
                    <input
                      className={FIELD}
                      value={consoleHost}
                      onChange={(e) => setConsoleHost(e.target.value)}
                      autoComplete="off"
                      placeholder="10.1.2.1"
                    />
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
                  Discovery and quarantine only watch selected UniFi networks. Host and TLS are stored when you save an
                  API key.
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
          </GatewayCard>

          <KeyCard unifi={unifi} sync={sync}>
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
                <p
                  className="text-[14px]"
                  style={{ color: apiKey.trim().length >= 8 ? "var(--ff-on)" : "var(--ff-muted)" }}
                >
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
          </KeyCard>
        </div>

        <HouseholdCard
          groups={groups}
          accounts={accounts}
          mutate={store.mutate}
          onCreateLogin={(group) => {
            setLoginFor(group);
            setLoginUser(usernameFromName(group.name));
            setPw1("");
            setPw2("");
          }}
        />
      </div>

      {loginFor ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--ff-scrim)] p-6">
          <div className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-[var(--ff-card)] shadow-[var(--ff-shadow-sheet)]">
            <div className="px-[18px] pt-[18px] pb-1">
              <div className="text-[17px] font-bold tracking-tight">{createLoginTitle(loginFor)}</div>
              <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">{SETTINGS_COPY.loginNote}</p>
            </div>
            <div className="px-[18px] py-3.5">
              <NewLoginFields
                username={loginUser}
                password={pw1}
                confirm={pw2}
                onChange={(field, value) => (field === "username" ? setLoginUser(value) : field === "password" ? setPw1(value) : setPw2(value))}
              />
            </div>
            <div className="flex border-t border-[var(--ff-hairline-card)]">
              <button
                type="button"
                className="flex-1 py-3 text-center text-[14px] text-[var(--ff-muted)]"
                onClick={() => setLoginFor(null)}
              >
                {SETTINGS_COPY.cancel}
              </button>
              <button
                type="button"
                disabled={!login.canCreate}
                className="flex-1 border-l border-[var(--ff-hairline-card)] py-3 text-center text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40"
                onClick={() => {
                  const group = loginFor;
                  void createLogin(store.mutate, group, loginUser, pw1).then((result) => {
                    if (result) setLoginFor(null);
                  });
                }}
              >
                {SETTINGS_COPY.createLogin}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
