"use client";

import { use, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { FAMILYFI_POLICY_PREFIX, MAX_POLICY_NAME, rulePolicyNames } from "@/lib/policy-names";
import { overlapNotices, ruleWritePlan, type RuleDraft, type RuleWrite } from "@/lib/rule-writes";
import {
  CURATED_CATEGORY_SLOTS,
  MAX_RULE_NAME,
  MAX_RULE_WINDOWS,
  MAX_WINDOW_NAME,
  normalizeDomain,
  type Rule,
  type RuleKind,
  type RuleWindow,
} from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { CategoryGlyph } from "@/components/ui/CategoryGlyph";
import { TextField, TimeField } from "@/components/ui/Controls";
import { DayPicker } from "@/components/ui/DayPicker";
import { Segmented } from "@/components/ui/Segmented";
import { RuleBar } from "./RulesList";

type Params = Promise<{ id: string }>;
type Search = Promise<{ group?: string | string[]; kind?: string | string[]; target?: string | string[] }>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const KINDS: { value: RuleKind; label: string }[] = [
  { value: "internet", label: "All internet" },
  { value: "category", label: "Categories" },
  { value: "app", label: "Apps" },
  { value: "domain", label: "Websites" },
];
const KIND_NOTE: Record<RuleKind, string> = {
  internet: "Every site and app on every device in the chosen groups.",
  category: "Only this category. Everything else stays on.",
  app: "Only these apps, matched by the gateway’s app detection. Everything else stays on.",
  domain: "Only these websites and their subdomains. Everything else stays on.",
};

/** A window being edited: `key` tells rows apart before a new window has an id. */
type EditWindow = RuleWindow & { key: string; removed?: boolean };
type Draft = Omit<RuleDraft, "windows"> & { scope: "group" | "network"; networkIds: string[]; enabled: boolean; windows: EditWindow[] };

let nextKey = 0;
const keyed = (window: RuleWindow): EditWindow => ({ ...window, key: window.id ?? `new-${nextKey++}` });

function fromRule(rule: Rule): Draft {
  return {
    id: rule.id,
    name: rule.name,
    useGeneratedName: rule.useGeneratedName,
    kind: rule.kind,
    scope: rule.scope,
    targetIds: [...rule.targetIds],
    domains: [...rule.domains],
    groupIds: [...rule.groupIds],
    networkIds: [...rule.networkIds],
    enabled: rule.enabled,
    mode: rule.mode,
    windows: rule.windows.map(keyed),
  };
}

function blankDraft(kind: RuleKind, groupId: string | undefined, target: number | undefined): Draft {
  const scheduled = kind === "internet";
  return {
    id: "",
    name: "",
    useGeneratedName: false,
    kind,
    scope: "group",
    targetIds: kind === "category" ? [target ?? CURATED_CATEGORY_SLOTS[0]!.categoryId] : [],
    domains: [],
    groupIds: groupId ? [groupId] : [],
    networkIds: [],
    enabled: true,
    mode: scheduled ? "scheduled" : "always",
    windows: scheduled ? [keyed({ name: "", days: EVERY_DAY, start: "21:00", end: "07:00" })] : [],
  };
}

/** The draft as it would be saved: removed windows dropped. */
function live(draft: Draft): RuleDraft {
  return {
    ...draft,
    windows: draft.mode === "scheduled" ? draft.windows.filter((window) => !window.removed).map(({ id, name, days, start, end }) => ({ id, name, days, start, end })) : [],
  };
}

export function RuleEditorPage({ params, searchParams }: { params?: Params; searchParams: Search }) {
  const id = params ? use(params).id : null;
  const search = use(searchParams);
  const { rules, loading } = useAppData();
  const rule = id ? rules.find((item) => item.id === id) : undefined;
  if (id && !rule) {
    if (loading) return null;
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">Rule not found.</p>;
  }
  const kind = KINDS.some((item) => item.value === one(search.kind)) ? (one(search.kind) as RuleKind) : "internet";
  const target = one(search.target) ? Number(one(search.target)) : undefined;
  return (
    <RuleEditor
      key={rule?.id ?? "new"}
      saved={rule ?? null}
      initial={rule ? fromRule(rule) : blankDraft(kind, one(search.group), Number.isFinite(target) ? target : undefined)}
      returnGroup={one(search.group) ?? null}
    />
  );
}

function RuleEditor({ saved, initial, returnGroup }: { saved: Rule | null; initial: Draft; returnGroup: string | null }) {
  const router = useRouter();
  const { groups, unifi, mutate, busy } = useAppData();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState("");
  const [domainDraft, setDomainDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<Draft>) => {
    setError("");
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setWindow = (key: string, patch: Partial<EditWindow>) =>
    set({ windows: draft.windows.map((window) => (window.key === key ? { ...window, ...patch } : window)) });

  const back = returnGroup ? `/rules?group=${returnGroup}` : "/rules";
  const backLabel = returnGroup ? `Rules for ${groups.find((group) => group.id === returnGroup)?.name ?? "this group"}` : "All rules";
  const current = live(draft);
  const liveWindows = draft.windows.filter((window) => !window.removed);
  const scheduled = draft.mode === "scheduled";
  const policyNames = rulePolicyNames({ ...current, id: saved?.id ?? "new0" });
  const writes = ruleWritePlan(saved ? live(fromRule(saved)) : null, { ...current, id: saved?.id ?? "new0" });
  const overlaps = scheduled ? overlapNotices(liveWindows) : [];
  const dirty = !saved || JSON.stringify(current) !== JSON.stringify(live(fromRule(saved)));
  const managedNetworks = (unifi?.networks ?? []).filter(
    (network) => unifi?.manageAllNetworks || unifi?.managedNetworkIds.includes(network.id),
  );

  function validate(): string | null {
    if (!draft.name.trim()) return "Give the rule a name.";
    if (draft.scope === "group" && draft.groupIds.length === 0) return "Pick at least one person or thing it applies to.";
    if (draft.scope === "network" && draft.networkIds.length === 0) return "Pick at least one network.";
    if (draft.kind === "domain" && draft.domains.length === 0) return "Add at least one website.";
    if ((draft.kind === "app" || draft.kind === "category") && draft.targetIds.length === 0) {
      return draft.kind === "app" ? "Pick at least one app." : "Pick a category.";
    }
    if (scheduled && liveWindows.length === 0) return "Add at least one window.";
    if (scheduled && liveWindows.some((window) => window.days.length === 0)) return "Each window needs at least one day.";
    if (scheduled && liveWindows.some((window) => window.start === window.end)) return "A window cannot start and end at the same time.";
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const body = {
      name: current.name.trim(),
      useGeneratedName: current.useGeneratedName,
      groupIds: draft.scope === "group" ? current.groupIds : undefined,
      networkIds: draft.scope === "network" ? draft.networkIds : undefined,
      targetIds: draft.kind === "category" || draft.kind === "app" ? current.targetIds : undefined,
      domains: draft.kind === "domain" ? current.domains : undefined,
      mode: current.mode,
      windows: current.windows,
    };
    const result = await mutate(
      () =>
        saved
          ? api<{ rule: Rule }>(`/api/v1/rules/${saved.id}`, { method: "PATCH", body: JSON.stringify(body) })
          : api<{ rule: Rule }>("/api/v1/rules", {
              method: "POST",
              body: JSON.stringify({ ...body, kind: draft.kind, scope: draft.scope, enabled: true }),
            }),
      undefined,
      { notice: `${body.name} ${saved ? "saved" : "created"}. FamilyFi writes it to the gateway next.` },
    );
    if (result?.rule) router.push(back);
  }

  async function remove() {
    if (!saved) return;
    const result = await mutate(
      async () => ({ ...(await api<object>(`/api/v1/rules/${saved.id}`, { method: "DELETE" })), removedRuleId: saved.id }),
      undefined,
      { notice: `${saved.name} deleted. Its UniFi policies are removed on the next reconcile.` },
    );
    if (result) router.push(back);
  }

  function addDomain() {
    const domain = normalizeDomain(domainDraft);
    if (!domain) {
      setError(`“${domainDraft.trim()}” is not a website domain.`);
      return;
    }
    if (!draft.domains.includes(domain)) set({ domains: [...draft.domains, domain] });
    setDomainDraft("");
  }

  const title = draft.name.trim() || saved?.name || "New rule";
  const summary = [
    KINDS.find((item) => item.value === draft.kind)!.label,
    scheduled ? `${liveWindows.length} ${liveWindows.length === 1 ? "window" : "windows"}` : "always",
    `${policyNames.length} UniFi ${policyNames.length === 1 ? "policy" : "policies"}`,
  ].join(" · ");

  return (
    <>
      <PageHeader title={title} sub={summary} onAction={() => void save()} actionLabel={saved ? "Save" : "Create rule"} />
      <form
        className="flex max-w-[760px] flex-col gap-4 p-4 md:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <Link href={back} className="text-[14px] font-semibold text-[var(--ff-accent)]">
            ‹ {backLabel}
          </Link>
          {saved && dirty ? <span className="text-[14px] text-[var(--ff-paused)]">Unsaved changes</span> : null}
        </div>
        {error ? (
          <p role="alert" className="rounded-[9px] px-3 py-2 text-[14px]" style={{ background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}

        <Section title="Name" note="What your household calls it, and what UniFi’s policy table shows.">
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-ink-3)]">
            Rule name
            <TextField label="Rule name" value={draft.name} onChange={(name) => set({ name })} placeholder="e.g. School nights" maxLength={MAX_RULE_NAME} />
          </label>
          <div className="rounded-[9px] bg-[var(--ff-field-soft)] p-3">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[14px] font-semibold">
                {policyNames.length > 1 ? "Names in UniFi · one policy per window" : "Name in UniFi"}
              </span>
              <button
                type="button"
                className="text-[14px] font-semibold text-[var(--ff-accent)]"
                onClick={() => set({ useGeneratedName: !draft.useGeneratedName })}
              >
                {draft.useGeneratedName ? "Use rule name" : "Use generated name"}
              </button>
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {policyNames.map((name, index) => (
                <li key={index} className="flex items-baseline gap-2 font-mono text-[14px]">
                  <span className="min-w-0 flex-1 break-words">
                    <span className="text-[var(--ff-ink-3)]">{FAMILYFI_POLICY_PREFIX}</span>
                    {name.slice(FAMILYFI_POLICY_PREFIX.length)}
                  </span>
                  <span className="flex-none text-[var(--ff-ink-3)]">
                    {name.length} / {MAX_POLICY_NAME}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[14px] leading-5 text-[var(--ff-ink-2)]">
              {policyNames.length > 1
                ? "Rule name, then the window name. The FamilyFi prefix is fixed, so administrators can tell FamilyFi’s policies apart."
                : "Follows the rule name. With a second window each policy gets the window’s name on the end."}
            </p>
          </div>
        </Section>

        <Section title="What it blocks" note={KIND_NOTE[draft.kind]}>
          <Segmented
            name="What it blocks"
            grow
            value={draft.kind}
            segments={KINDS.map((item) => ({ ...item, disabled: Boolean(saved) && item.value !== draft.kind }))}
            onChange={(kind) =>
              set({
                kind,
                scope: kind === "internet" ? "group" : draft.scope,
                mode: kind === "internet" ? "scheduled" : draft.mode,
                targetIds: kind === "category" ? [CURATED_CATEGORY_SLOTS[0]!.categoryId] : [],
                windows:
                  kind === "internet" && draft.windows.every((window) => window.removed)
                    ? [...draft.windows, keyed({ name: "", days: EVERY_DAY, start: "21:00", end: "07:00" })]
                    : draft.windows,
              })
            }
          />
          {saved ? <p className="text-[14px] text-[var(--ff-ink-2)]">A saved rule keeps what it blocks. Make a new rule to block something else.</p> : null}
          {draft.kind === "category" ? (
            <ChipGroup label="Category">
              {CURATED_CATEGORY_SLOTS.map((slot) => (
                <Chip
                  key={slot.slot}
                  on={draft.targetIds.includes(slot.categoryId)}
                  tone="rule"
                  onClick={() => set({ targetIds: [slot.categoryId] })}
                >
                  <CategoryGlyph slot={slot.slot} size={13} />
                  {slot.label}
                </Chip>
              ))}
            </ChipGroup>
          ) : null}
          {draft.kind === "app" ? <AppPicker targetIds={draft.targetIds} onChange={(targetIds) => set({ targetIds })} /> : null}
          {draft.kind === "domain" ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-[var(--ff-input-line)] bg-[var(--ff-card)] p-2">
                {draft.domains.map((domain) => (
                  <span key={domain} className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--ff-field)] px-2 py-1 font-mono text-[14px]">
                    {domain}
                    <button
                      type="button"
                      aria-label={`Remove ${domain}`}
                      className="text-[var(--ff-danger)]"
                      onClick={() => set({ domains: draft.domains.filter((item) => item !== domain) })}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className="min-w-[180px] flex-1">
                  <TextField label="Add a website" value={domainDraft} onChange={setDomainDraft} onSubmit={addDomain} placeholder="Add a domain, then Enter" mono />
                </div>
              </div>
              <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">
                Subdomains are included. The gateway matches websites by their DNS lookups, so a device using encrypted DNS can get around this.
              </p>
            </div>
          ) : null}
        </Section>

        <Section title="When" note="Each window is its own UniFi policy with one schedule. Windows can cross midnight.">
          {draft.kind !== "internet" ? (
            <Segmented
              name="When"
              value={draft.mode}
              segments={[
                { value: "always", label: "Always" },
                { value: "scheduled", label: "Scheduled" },
              ]}
              onChange={(mode) =>
                set({
                  mode,
                  windows:
                    mode === "scheduled" && liveWindows.length === 0
                      ? [...draft.windows, keyed({ name: "", days: EVERY_DAY, start: "21:00", end: "07:00" })]
                      : draft.windows,
                })
              }
            />
          ) : null}
          {!scheduled ? (
            <p className="text-[14px] text-[var(--ff-ink-2)]">Blocked all day, every day. One UniFi policy.</p>
          ) : (
            <>
              <RuleBar rule={{ kind: draft.kind, mode: "scheduled", windows: liveWindows }} />
              {draft.windows.map((window) => {
                const index = liveWindows.indexOf(window);
                if (window.removed) {
                  return (
                    <div key={window.key} className="flex items-center gap-2 rounded-[9px] bg-[var(--ff-field-soft)] px-3 py-2 text-[14px]">
                      <span className="flex-1">
                        <span className="line-through">{window.name || "Window"}</span> · removed on save.
                      </span>
                      <button type="button" className="font-semibold text-[var(--ff-accent)]" onClick={() => setWindow(window.key, { removed: false })}>
                        Undo
                      </button>
                    </div>
                  );
                }
                return (
                  <fieldset key={window.key} className="m-0 flex flex-col gap-2.5 rounded-[9px] border border-[var(--ff-hairline-card)] p-3">
                    <legend className="sr-only">{window.name || `Window ${index + 1}`}</legend>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <TextField
                          label={`Window ${index + 1} name`}
                          value={window.name}
                          onChange={(name) => setWindow(window.key, { name })}
                          placeholder={`Window ${index + 1} name`}
                          maxLength={MAX_WINDOW_NAME}
                        />
                      </div>
                      {saved && !window.id ? <span className="flex-none text-[14px] text-[var(--ff-on)]">New · adds 1 policy</span> : null}
                      {liveWindows.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Remove ${window.name || `window ${index + 1}`}`}
                          className="flex h-7 w-7 flex-none items-center justify-center rounded-[6px] text-[17px] text-[var(--ff-danger)]"
                          onClick={() =>
                            window.id
                              ? setWindow(window.key, { removed: true })
                              : set({ windows: draft.windows.filter((item) => item.key !== window.key) })
                          }
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <TimeField label={draft.kind === "internet" ? "Offline" : "Blocked"} value={window.start} onChange={(start) => setWindow(window.key, { start })} />
                      <TimeField label={draft.kind === "internet" ? "Back on" : "Until"} value={window.end} onChange={(end) => setWindow(window.key, { end })} />
                      <DayPicker
                        days={window.days}
                        onToggle={(day) =>
                          setWindow(window.key, {
                            days: window.days.includes(day) ? window.days.filter((item) => item !== day) : [...window.days, day].sort(),
                          })
                        }
                      />
                    </div>
                    {liveWindows.length === 1 ? (
                      <p className="text-[14px] text-[var(--ff-ink-2)]">A scheduled rule needs at least one window. To remove it entirely, delete the rule.</p>
                    ) : null}
                  </fieldset>
                );
              })}
              {overlaps.length ? (
                <p role="status" className="rounded-[9px] bg-[var(--ff-paused-fill)] px-3 py-2 text-[14px] leading-5">
                  {overlaps.join(" ")} Both block while they overlap; access comes back when the later one ends.
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={liveWindows.length >= MAX_RULE_WINDOWS}
                  className="text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-50"
                  onClick={() => set({ windows: [...draft.windows, keyed({ name: "", days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00" })] })}
                >
                  + Add window
                </button>
                <span className="text-[14px] text-[var(--ff-ink-2)]">Each window adds one UniFi policy</span>
              </div>
            </>
          )}
        </Section>

        <Section title="Applies to" note="People and things. One rule can cover several.">
          {draft.kind !== "internet" && managedNetworks.length ? (
            <Segmented
              name="Applies to"
              value={draft.scope}
              segments={[
                { value: "group", label: "People and things", disabled: Boolean(saved) && draft.scope !== "group" },
                { value: "network", label: "Whole networks", disabled: Boolean(saved) && draft.scope !== "network" },
              ]}
              onChange={(scope) => set({ scope })}
            />
          ) : null}
          {draft.scope === "group" ? (
            <ChipGroup label="Groups">
              {groups.map((group) => {
                const on = draft.groupIds.includes(group.id);
                return (
                  <Chip
                    key={group.id}
                    on={on}
                    disabled={group.protected}
                    onClick={() => set({ groupIds: on ? draft.groupIds.filter((id) => id !== group.id) : [...draft.groupIds, group.id] })}
                  >
                    {group.name}
                    {group.protected ? " · protected" : ""}
                  </Chip>
                );
              })}
            </ChipGroup>
          ) : (
            <ChipGroup label="Networks">
              {managedNetworks.map((network) => {
                const on = draft.networkIds.includes(network.id);
                return (
                  <Chip
                    key={network.id}
                    on={on}
                    onClick={() => set({ networkIds: on ? draft.networkIds.filter((id) => id !== network.id) : [...draft.networkIds, network.id] })}
                  >
                    {network.name}
                  </Chip>
                );
              })}
            </ChipGroup>
          )}
        </Section>

        <Section title="What FamilyFi will write" note="Applied on the next reconcile. Your own UniFi policies are never touched.">
          <Writes writes={writes} />
        </Section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-50">
            {saved ? "Save" : "Create rule"}
          </button>
          <Link href={back} className="rounded-lg border border-[var(--ff-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-accent)]">
            Cancel
          </Link>
          {saved ? (
            <button
              type="button"
              className="ml-auto rounded-lg px-3.5 py-2 text-[14px] font-semibold"
              style={{ background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete rule…
            </button>
          ) : null}
        </div>
      </form>

      {confirmDelete && saved ? (
        <div className="fixed inset-0 z-[81] flex items-center justify-center bg-[var(--ff-scrim)] p-6" onClick={() => setConfirmDelete(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-rule-title"
            className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-[var(--ff-card)]"
            style={{ boxShadow: "var(--ff-shadow-sheet)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2 p-5">
              <h2 id="delete-rule-title" className="text-[17px] font-bold tracking-tight">
                Delete “{saved.name}”?
              </h2>
              <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">
                Removes {saved.policyNames.length === 1 ? "its UniFi policy" : `all ${saved.policyNames.length} of its UniFi policies`} on the next
                reconcile, and discards unsaved edits. Other rules are not affected. This can’t be undone.
              </p>
              <ul className="font-mono text-[14px] text-[var(--ff-ink-2)]">
                {saved.policyNames.map((name) => (
                  <li key={name} className="line-through">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex border-t border-[var(--ff-hairline-card)]">
              <button type="button" className="flex-1 py-3 text-[14px] text-[var(--ff-ink-3)]" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 border-l border-[var(--ff-hairline-card)] py-3 text-[14px] font-semibold text-[var(--ff-danger)]"
                onClick={() => void remove()}
              >
                Delete rule
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px]">
      <div>
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-ink-2)]">{note}</p>
      </div>
      {children}
    </section>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  disabled,
  tone = "accent",
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: "accent" | "rule";
  children: ReactNode;
}) {
  const colors = on
    ? tone === "rule"
      ? { background: "var(--ff-verdict-rule-fill)", color: "var(--ff-verdict-rule-ink)", borderColor: "var(--ff-verdict-rule-line)" }
      : { background: "var(--ff-accent-fill)", color: "var(--ff-accent-hover)", borderColor: "var(--ff-accent-line)" }
    : { background: "var(--ff-card)", color: "var(--ff-ink-2)", borderColor: "var(--ff-hairline-card)" };
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      style={colors}
    >
      <span aria-hidden>{on ? "✓" : "+"}</span>
      {children}
    </button>
  );
}

const VERB_STYLE: Record<RuleWrite["verb"], { background: string; color: string }> = {
  NEW: { background: "var(--ff-on-tint)", color: "var(--ff-on)" },
  CHANGE: { background: "var(--ff-accent-fill)", color: "var(--ff-accent)" },
  DELETE: { background: "var(--ff-danger-fill)", color: "var(--ff-danger)" },
  KEEP: { background: "var(--ff-field)", color: "var(--ff-ink-3)" },
};

function Writes({ writes }: { writes: RuleWrite[] }) {
  return (
    <ul className="flex flex-col">
      {writes.map((write, index) => (
        <li key={`${write.verb}:${write.name}:${index}`} className="flex items-start gap-2.5 border-t border-[var(--ff-hairline)] py-2 first:border-t-0">
          <span className="flex-none rounded-[5px] px-1.5 py-0.5 text-[12px] font-bold tracking-wide" style={VERB_STYLE[write.verb]}>
            {write.verb}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`font-mono text-[14px] break-words ${write.verb === "DELETE" ? "line-through" : ""}`}>{write.name}</div>
            <div className="text-[14px] text-[var(--ff-ink-2)]">{write.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Search the gateway's app catalog and pick apps; each pick is a DPI id. */
function AppPicker({ targetIds, onChange }: { targetIds: number[]; onChange: (ids: number[]) => void }) {
  const [filter, setFilter] = useState("");
  const [catalog, setCatalog] = useState<{ id: number; name: string }[]>([]);
  const [known, setKnown] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void api<{ applications: { id: number; name: string }[] }>(
        `/api/v1/dpi/applications${filter.trim() ? `?filter=${encodeURIComponent(filter.trim())}` : ""}`,
      )
        .then((res) => {
          setCatalog(res.applications.slice(0, 30));
          setKnown((current) => new Map([...current, ...res.applications.map((item) => [item.id, item.name] as const)]));
        })
        .catch(() => setCatalog([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [filter]);
  const picked = useMemo(() => targetIds.map((id) => ({ id, name: known.get(id) ?? `App ${id}` })), [targetIds, known]);
  return (
    <div className="flex flex-col gap-2">
      <ChipGroup label="Chosen apps">
        {picked.map((app) => (
          <Chip key={app.id} on tone="rule" onClick={() => onChange(targetIds.filter((id) => id !== app.id))}>
            {app.name}
          </Chip>
        ))}
      </ChipGroup>
      <TextField label="Search apps" value={filter} onChange={setFilter} placeholder="Search the gateway’s app catalog" />
      <ChipGroup label="Apps">
        {catalog
          .filter((app) => !targetIds.includes(app.id))
          .map((app) => (
            <Chip key={app.id} on={false} onClick={() => onChange([...targetIds, app.id])}>
              {app.name}
            </Chip>
          ))}
      </ChipGroup>
    </div>
  );
}

