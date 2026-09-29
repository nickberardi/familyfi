"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { FAMILYFI_POLICY_PREFIX, MAX_POLICY_NAME, rulePolicyNames } from "@/lib/policy-names";
import { overlapNotices, ruleWritePlan, type RuleDraft, type RuleWrite } from "@/lib/rule-writes";
import {
  CURATED_CATEGORY_SLOTS,
  catalogLabel,
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
type Search = Promise<{
  group?: string | string[];
  kind?: string | string[];
  target?: string | string[];
  /** A starting name, e.g. "AI for Sam" from a category's sheet. */
  name?: string | string[];
  /** Comma-separated websites for a Websites rule, e.g. a category's domains. */
  domains?: string | string[];
}>;

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

function blankDraft(
  kind: RuleKind,
  groupId: string | undefined,
  target: number | undefined,
  prefill: { name?: string; domains?: string } = {},
): Draft {
  const scheduled = kind === "internet";
  const domains = kind === "domain" && prefill.domains ? prefill.domains.split(",").map(normalizeDomain).filter((item): item is string => Boolean(item)) : [];
  return {
    id: "",
    name: (prefill.name ?? "").slice(0, MAX_RULE_NAME),
    useGeneratedName: false,
    kind,
    scope: "group",
    targetIds: kind === "category" && target !== undefined ? [target] : [],
    domains: [...new Set(domains)],
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
      initial={
        rule
          ? fromRule(rule)
          : blankDraft(kind, one(search.group), Number.isFinite(target) ? target : undefined, { name: one(search.name), domains: one(search.domains) })
      }
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
      return draft.kind === "app" ? "Pick at least one app." : "Pick at least one category.";
    }
    if (scheduled && liveWindows.length === 0) return "Add at least one window.";
    if (scheduled && liveWindows.some((window) => window.days.length === 0)) return "Each window needs at least one day.";
    if (scheduled && liveWindows.some((window) => window.start === window.end)) return "A window cannot start and end at the same time.";
    return null;
  }

  async function save() {
    if (busy) return;
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
      <PageHeader
        title={title}
        sub={summary}
        onAction={() => void save()}
        actionLabel={saved ? "Save" : "Create rule"}
        secondary={
          saved ? (
            <button
              type="button"
              className="rounded-lg px-3.5 py-2 text-[14px] font-semibold"
              style={{ background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete rule…
            </button>
          ) : null
        }
      />
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
                targetIds: [],
                windows:
                  kind === "internet" && draft.windows.every((window) => window.removed)
                    ? [...draft.windows, keyed({ name: "", days: EVERY_DAY, start: "21:00", end: "07:00" })]
                    : draft.windows,
              })
            }
          />
          {saved ? <p className="text-[14px] text-[var(--ff-ink-2)]">A saved rule keeps what it blocks. Make a new rule to block something else.</p> : null}
          {draft.kind === "category" || draft.kind === "app" ? (
            <CatalogPicker key={draft.kind} kind={draft.kind} targetIds={draft.targetIds} onChange={(targetIds) => set({ targetIds })} />
          ) : null}
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
          {managedNetworks.length ? (
            <Segmented
              name="Applies to"
              value={draft.scope}
              segments={[
                { value: "group", label: "People and things", disabled: Boolean(saved) && draft.scope !== "group" },
                {
                  value: "network",
                  label: "Whole networks",
                  disabled: draft.kind === "internet" || (Boolean(saved) && draft.scope !== "network"),
                },
              ]}
              onChange={(scope) => set({ scope })}
            />
          ) : null}
          {draft.kind === "internet" ? (
            <p className="text-[14px] text-[var(--ff-ink-2)]">
              All internet can&rsquo;t be blocked for a whole network, which would take every device offline. Choose the people and things it applies to.
            </p>
          ) : null}
          {draft.scope === "group" ? (
            <ChipGroup label="Groups">
              {groups.map((group) => {
                const on = draft.groupIds.includes(group.id);
                return (
                  <Chip
                    key={group.id}
                    on={on}
                    onClick={() => set({ groupIds: on ? draft.groupIds.filter((id) => id !== group.id) : [...draft.groupIds, group.id] })}
                  >
                    {group.name}
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

type CatalogItem = { id: number; name: string };

/** Where each kind of rule finds what it can block: the gateway's own DPI catalogs. */
const CATALOGS = {
  category: { path: "/api/v1/dpi/categories", key: "categories", noun: "category", nouns: "categories" },
  app: { path: "/api/v1/dpi/applications", key: "applications", noun: "app", nouns: "apps" },
} as const;

/**
 * The categories or apps a rule blocks, picked the way websites are: the box holds only
 * what is picked, and a search asks the gateway's catalog (`?filter=`) for matches to add.
 * Nothing is listed by hand, so whatever the gateway supports can be found.
 */
function CatalogPicker({ kind, targetIds, onChange }: { kind: "category" | "app"; targetIds: number[]; onChange: (ids: number[]) => void }) {
  const source = CATALOGS[kind];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; items: CatalogItem[] }>({ query: "", items: [] });
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState("");
  const remember = (items: CatalogItem[]) => setNames((current) => new Map([...current, ...items.map((item) => [item.id, item.name] as const)]));
  const fetchCatalog = (filter: string) =>
    api<Record<string, CatalogItem[]>>(`${source.path}${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`).then((res) => res[source.key] ?? []);

  // A saved rule's picks need their names once.
  const [initial] = useState(targetIds);
  useEffect(() => {
    if (initial.length === 0) return;
    let cancelled = false;
    void fetchCatalog("")
      .then((items) => {
        if (!cancelled) remember(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Only the rule as it was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Search as you type, and drop answers to a query that has since changed.
  useEffect(() => {
    const filter = query.trim();
    if (!filter) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void fetchCatalog(filter)
        .then((items) => {
          if (cancelled) return;
          remember(items);
          setResults({ query: filter, items: items.slice(0, 30) });
          setError("");
        })
        .catch(() => {
          if (!cancelled) setError(`Couldn’t search the gateway’s ${source.nouns}.`);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filter = query.trim();
  // The gateway knows "Video" as "Media streaming", so a familiar name matches too.
  const familiar =
    kind === "category" && filter
      ? CURATED_CATEGORY_SLOTS.filter((item) => item.label.toLowerCase().includes(filter.toLowerCase())).map((item) => ({ id: item.categoryId, name: item.catalogName }))
      : [];
  const found = filter && results.query === filter ? results.items : [];
  const matches = [...familiar, ...found.filter((item) => !familiar.some((known) => known.id === item.id))].filter((item) => !targetIds.includes(item.id));
  const label = (id: number) => catalogLabel(kind, id, names);
  const slot = (id: number) => (kind === "category" ? CURATED_CATEGORY_SLOTS.find((item) => item.categoryId === id) : undefined);
  const add = (id: number) => {
    onChange([...targetIds, id]);
    setQuery("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-[var(--ff-input-line)] bg-[var(--ff-card)] p-2">
        {targetIds.map((id) => {
          const known = slot(id);
          return (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--ff-field)] px-2 py-1 text-[14px]">
              {known ? <CategoryGlyph slot={known.slot} size={12} /> : null}
              {label(id)}
              <button type="button" aria-label={`Remove ${label(id)}`} className="text-[var(--ff-danger)]" onClick={() => onChange(targetIds.filter((item) => item !== id))}>
                ×
              </button>
            </span>
          );
        })}
        <div className="min-w-[180px] flex-1">
          <TextField
            label={`Search ${source.nouns}`}
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              if (matches[0]) add(matches[0].id);
            }}
            placeholder={`Search the gateway’s ${source.nouns}`}
          />
        </div>
      </div>
      {matches.length ? (
        <ChipGroup label={`Matching ${source.nouns}`}>
          {matches.map((item) => (
            <Chip key={item.id} on={false} tone="rule" onClick={() => add(item.id)}>
              {slot(item.id) ? <CategoryGlyph slot={slot(item.id)!.slot} size={13} /> : null}
              {label(item.id)}
            </Chip>
          ))}
        </ChipGroup>
      ) : filter && results.query === filter && !error && !familiar.length ? (
        <p className="text-[14px] text-[var(--ff-ink-2)]">No {source.nouns} match “{filter}”.</p>
      ) : null}
      {error ? <p className="text-[14px] text-[var(--ff-danger)]">{error}</p> : null}
      <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">
        Search what the gateway can detect, and pick as many {source.nouns} as the rule should block.
      </p>
    </div>
  );
}

