"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/components/AppDataProvider";
import { BackupImport } from "@/components/BackupImport";
import { FIELD } from "@/components/pair/SheetFrame";
import { AdminSignInStep, BODY, CHECKBOX, ROW_RULE, SetupFrame, TITLE } from "@/components/setup/SetupFrame";
import { Icon } from "@/components/ui/Icon";
import { api, request } from "@/lib/api";
import { consoleHostFromBaseUrl, localIntegrationBaseFromHost } from "@/lib/unifi-host";
import {
  SCHEDULE_SUGGESTIONS,
  initialNetworkSelection,
  networkSelectionBody,
  existingSuggestedRules,
  saveMembers,
  saveSchedules,
  setupCta,
  setupStepError,
  suggestionApplies,
  suggestionAppliesTo,
  suggestionTimes,
  type CreatedRules,
  type SetupMember,
} from "@/lib/setup";
import type { UnifiNetwork } from "@/lib/types";
import { FamilyRolePicker } from "@/ui/FamilyRolePicker";

type Probe = { applicationVersion: string; site: { name: string }; networks: UnifiNetwork[] };

const LABEL = "text-[14px] font-semibold text-[var(--ff-muted)]";
const LIST = "flex flex-col rounded-[10px] border border-[var(--ff-line)]";
/** The sheets' field, without the gap under its label, for the add row. */
const ROW_FIELD = FIELD.replace("mt-1 ", "");

/**
 * First-time setup, signed in: the admin sign-in, the gateway, the networks it watches, the people
 * who live there and a few suggested schedules. Each step saves through the same API Settings and
 * Rules use, so leaving part-way keeps what was done. `password` is the admin password while the
 * household has no gateway yet, and null after.
 */
export function SetupWizard({ initialStep = 0, password }: { initialStep?: number; password: string | null }) {
  const router = useRouter();
  const { unifi, groups, rules, accounts, error: loadError, reload } = useAppData();
  const [step, setStep] = useState(initialStep);
  // Coming from the signed-out first step, the password was saved there already.
  const [wrote, setWrote] = useState(initialStep > 0);
  const [host, setHost] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [members, setMembers] = useState<SetupMember[] | null>(null);
  const [newName, setNewName] = useState("");
  const [scheduled, setScheduled] = useState<Record<string, boolean> | null>(null);
  const [createdRules, setCreatedRules] = useState<CreatedRules | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // Start from what the household already has, once it has loaded. A failed first load leaves
  // `unifi` empty, and setup waits rather than starting from an empty household.
  const ready = unifi !== null;
  const savedHost = consoleHostFromBaseUrl(unifi?.baseUrl ?? null);
  if (ready && host === null) setHost(savedHost);
  if (ready && siteId === null) setSiteId(unifi.siteId ?? "");
  if (ready && members === null) {
    setMembers(
      groups
        .filter((group) => group.kind === "family")
        .map((group) => ({ id: group.id, name: group.name, role: group.familyRole ?? "adult", savedRole: group.familyRole ?? "adult" })),
    );
  }
  if (ready && createdRules === null) setCreatedRules(existingSuggestedRules(rules));
  if (ready && scheduled === null) {
    // Running setup again never suggests a schedule the household already made.
    const names = new Set(rules.map((rule) => rule.name));
    setScheduled(Object.fromEntries(SCHEDULE_SUGGESTIONS.map((item) => [item.id, item.on && !item.rules.some((rule) => names.has(rule.name))])));
  }

  const hostValue = host ?? "";
  const people = members ?? [];
  const siteValue = siteId ?? "";
  // The saved key is tested and kept while the host and site are the saved ones and no new key is pasted.
  // A cloud console has no host here, so its saved key is kept while the host is left empty.
  const usingSaved =
    Boolean(unifi?.configured) &&
    !apiKey.trim() &&
    hostValue.trim() === savedHost &&
    siteValue.trim() === (unifi?.siteId ?? "");
  const connected = probe !== null;
  const networks = probe?.networks ?? unifi?.networks ?? [];
  const chosen = selected ?? [];
  const suggestions = SCHEDULE_SUGGESTIONS.map((item) => ({
    item,
    applies: suggestionApplies(item, people),
    on: Boolean(scheduled?.[item.id]) && suggestionApplies(item, people),
  }));
  const hasKids = people.some((member) => member.role !== "adult");

  function changeGateway(next: { host?: string; apiKey?: string; siteId?: string }) {
    if (next.host !== undefined) setHost(next.host);
    if (next.apiKey !== undefined) setApiKey(next.apiKey);
    if (next.siteId !== undefined) setSiteId(next.siteId);
    setProbe(null);
    setSelected(null);
    setError("");
  }

  async function run(work: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function gatewayTarget() {
    return {
      apiKey: apiKey.trim(),
      baseUrl: localIntegrationBaseFromHost(hostValue),
      siteId: siteValue.trim() || undefined,
      // Local consoles use self-signed certificates; a household that turned checking on keeps it.
      tlsInsecure: unifi?.configured ? unifi.tlsInsecure : true,
    };
  }

  async function testGateway() {
    // An empty body tests the saved connection.
    const body = usingSaved ? {} : gatewayTarget();
    const result = await api<Probe>("/api/v1/settings/unifi/test", { method: "POST", body: JSON.stringify(body) });
    setProbe(result);
  }

  async function saveGateway() {
    const selection = networkSelectionBody(unifi, networks, chosen);
    const body = usingSaved ? selection : { ...gatewayTarget(), ...selection };
    await api("/api/v1/settings/unifi", { method: "PUT", body: JSON.stringify(body) });
    await reload();
  }

  async function saveHousehold() {
    const result = await saveMembers(request, people);
    setMembers(result.members);
    await reload();
    if (result.error) throw new Error(result.error);
  }

  async function saveChosenSchedules() {
    const on = suggestions.filter((entry) => entry.on).map((entry) => entry.item);
    const result = await saveSchedules(request, on, people, createdRules ?? {});
    setCreatedRules(result.created);
    await reload();
    if (result.error) throw new Error(result.error);
  }

  function enter(next: number) {
    if (next === 2 && selected === null) setSelected(initialNetworkSelection(unifi, networks));
    setStep(next);
  }

  function next() {
    if (pending) return;
    if (step === 5) {
      router.replace("/family");
      return;
    }
    const problem = setupStepError(step, {
      wrote,
      connected,
      savedKey: usingSaved,
      host: hostValue,
      apiKey,
      selectedNetworks: chosen,
      members: people,
    });
    if (problem) {
      setError(problem);
      return;
    }
    if (step === 1 && !connected) return void run(testGateway);
    if (step === 2) return void run(async () => (await saveGateway(), enter(3)));
    if (step === 3) return void run(async () => (await saveHousehold(), enter(4)));
    if (step === 4) return void run(async () => (await saveChosenSchedules(), enter(5)));
    setError("");
    enter(step + 1);
  }

  function addMember() {
    const name = newName.trim();
    if (!name) return;
    setMembers([...people, { name, role: "child" }]);
    setNewName("");
    setError("");
  }

  const monitored = networkSelectionBody(unifi, networks, chosen);
  const summary = [
    { label: "Gateway", value: [hostValue.trim(), probe ? `site ${probe.site.name}` : null].filter(Boolean).join(" · ") },
    { label: "Networks", value: monitored.manageAllNetworks ? "Every network" : `${monitored.managedNetworkIds.length} watched` },
    { label: "Household", value: `${people.length} ${people.length === 1 ? "person" : "people"}` },
    { label: "Schedules", value: `${suggestions.filter((entry) => entry.on).length} on` },
  ];

  return (
    <SetupFrame
      step={step}
      error={error || (!ready && loadError) || ""}
      pending={pending}
      cta={setupCta(step, connected)}
      disabled={!ready}
      onBack={
        step > 0 && step < 5
          ? () => {
              setError("");
              setStep(step - 1);
            }
          : undefined
      }
      onNext={next}
    >
      {step === 0 ? (
        <AdminSignInStep
          password={password}
          wrote={wrote}
          onWrote={() => {
            setWrote(!wrote);
            setError("");
          }}
        />
      ) : null}

      {step === 1 ? (
        <>
          <h2 id="setup-step-title" className={TITLE}>
            Connect your gateway
          </h2>
          <p className={BODY}>
            Create a key in UniFi Network under Settings › Control Plane › Integrations. FamilyFi only adds its own
            policies; yours are never touched.
          </p>
          <label className={LABEL}>
            Gateway host
            <input
              className={FIELD}
              value={hostValue}
              onChange={(event) => changeGateway({ host: event.target.value })}
              placeholder="e.g. 192.168.1.1"
              autoComplete="off"
            />
          </label>
          <label className={LABEL}>
            API key
            <input
              className={FIELD}
              type="password"
              value={apiKey}
              onChange={(event) => changeGateway({ apiKey: event.target.value })}
              placeholder={
                unifi?.configured
                  ? `Saved key ${unifi.apiKeyMasked ?? ""}; paste a new one to replace it`
                  : "Paste your Network Integration API key"
              }
              autoComplete="off"
            />
          </label>
          <label className={LABEL}>
            Site ID (only for a console with more than one site)
            <input
              className={`${FIELD} font-mono`}
              value={siteValue}
              onChange={(event) => changeGateway({ siteId: event.target.value })}
              autoComplete="off"
            />
          </label>
          {probe ? (
            <p
              role="status"
              className="m-0 flex items-center gap-2 rounded-[9px] bg-[var(--ff-on-tint)] px-3 py-2.5 text-[14px] text-[var(--ff-on)]"
            >
              <Icon name="check-circle" size={16} />
              Connected to UniFi Network {probe.applicationVersion} · site {probe.site.name}
            </p>
          ) : null}
          <details className="rounded-[10px] border border-[var(--ff-line)] px-3.5 py-3" data-testid="setup-restore">
            <summary className="cursor-pointer text-[14px] font-semibold text-[var(--ff-ink)]">Restore from an export</summary>
            <div className="mt-2.5">
              <BackupImport
                onImported={async () => {
                  await reload();
                  // Start the remaining steps from the restored household: its gateway, people and rules.
                  setHost(null);
                  setSiteId(null);
                  setMembers(null);
                  setCreatedRules(null);
                  setScheduled(null);
                  setProbe(null);
                  setSelected(null);
                }}
              />
            </div>
          </details>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h2 id="setup-step-title" className={TITLE}>
            Pick networks to watch
          </h2>
          <p className={BODY}>
            Rules and schedules apply to devices on these networks. New devices that join them show as Unassigned
            on the Devices page until you assign them.
          </p>
          {networks.length === 0 ? (
            <p className={BODY}>The gateway didn’t list any networks. Go back and test the connection again.</p>
          ) : (
            <div className={LIST}>
              {networks.map((network) => (
                <label key={network.id} className={`flex cursor-pointer items-center gap-3 px-3.5 py-3 ${ROW_RULE}`}>
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    checked={chosen.includes(network.id)}
                    onChange={(event) => {
                      setError("");
                      setSelected(event.target.checked ? [...chosen, network.id] : chosen.filter((id) => id !== network.id));
                    }}
                  />
                  <span className="flex-1 text-[14px] font-semibold text-[var(--ff-ink)]">{network.name}</span>
                  <span className="font-mono text-[14px] text-[var(--ff-muted)]">VLAN {network.vlanId}</span>
                </label>
              ))}
            </div>
          )}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <h2 id="setup-step-title" className={TITLE}>
            Add your household
          </h2>
          <p className={BODY}>
            Adults can be made admins later in Settings. Teens and children get rules and schedules; they never sign
            in to FamilyFi.
          </p>
          {people.length ? (
            <ul className={`m-0 list-none p-0 ${LIST}`}>
              {people.map((member, index) => (
                <li key={member.id ?? `new-${index}`} className={`flex items-center gap-2.5 py-2 pl-3.5 pr-2.5 ${ROW_RULE}`}>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--ff-ink)]">{member.name}</span>
                  <FamilyRolePicker
                    group={{ id: member.id ?? "", name: member.name, familyRole: member.role }}
                    // A member with a login stays an adult, as in Settings.
                    locked={accounts.some((account) => account.groupId === member.id)}
                    onChange={(role) => {
                      setError("");
                      setMembers(people.map((entry, at) => (at === index ? { ...entry, role } : entry)));
                    }}
                  />
                  {member.id ? (
                    // Saved people are removed from the Family page, where their devices and rules are in view.
                    <span className="w-[30px]" />
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${member.name}`}
                      className="flex rounded-md p-[7px] text-[var(--ff-muted)]"
                      onClick={() => setMembers(people.filter((_, at) => at !== index))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addMember();
            }}
          >
            <input
              aria-label="Name"
              className={`${ROW_FIELD} min-w-0 flex-1`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Add a name"
              autoComplete="off"
            />
            <button
              type="submit"
              className="rounded-lg border border-[var(--ff-line)] px-3.5 text-[14px] font-semibold text-[var(--ff-accent)]"
            >
              Add
            </button>
          </form>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <h2 id="setup-step-title" className={TITLE}>
            Suggested schedules
          </h2>
          <p className={BODY}>Common starting points for teens and children. Turn on the ones that fit; you can adjust times later.</p>
          {hasKids ? (
            <div className={LIST}>
              {suggestions.map(({ item, applies, on }) => (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 px-3.5 py-3 ${applies ? "cursor-pointer" : ""} ${ROW_RULE}`}
                >
                  <input
                    type="checkbox"
                    className={`${CHECKBOX} mt-[3px]`}
                    checked={on}
                    disabled={!applies}
                    onChange={() => setScheduled({ ...scheduled, [item.id]: !on })}
                  />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[14px] font-semibold text-[var(--ff-ink)]">{item.name}</span>
                    <span className={BODY}>
                      {suggestionTimes(item)} · {item.what}
                    </span>
                    <span className={BODY}>{suggestionAppliesTo(item, people)}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className={`rounded-[10px] bg-[var(--ff-field)] px-3.5 py-3 ${BODY}`}>
              No teens or children in the household, so there’s nothing to schedule. You can add rules for anyone
              later.
            </p>
          )}
        </>
      ) : null}

      {step === 5 ? (
        <>
          <h2 id="setup-step-title" className={`${TITLE} flex items-center gap-2`}>
            <Icon name="check-circle" size={20} color="var(--ff-on)" />
            Household ready
          </h2>
          <dl className="m-0 flex flex-col rounded-[10px] bg-[var(--ff-field)]">
            {summary.map((row) => (
              <div key={row.label} className={`flex gap-3 px-3.5 py-2.5 text-[14px] ${ROW_RULE}`}>
                <dt className="w-[90px] flex-none font-semibold text-[var(--ff-muted)]">{row.label}</dt>
                <dd className="m-0 flex-1 text-[var(--ff-ink)]">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className={BODY}>Next, assign devices to people on the Devices page.</p>
        </>
      ) : null}
    </SetupFrame>
  );
}
