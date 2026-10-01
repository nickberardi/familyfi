"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import { FAMILYFI_POLICY_PREFIX, MAX_POLICY_NAME } from "@/lib/policy-names";
import { CATALOG_RESULTS_SHOWN, catalogCopy, catalogFamiliar, catalogMatches, searchCatalog, type CatalogItem } from "@/lib/rule-catalog";
import {
  KIND_NOTE,
  RULE_EDITOR_COPY as COPY,
  RULE_KINDS as KINDS,
  addDomain as addDomainTo,
  addWindow,
  blankDraft,
  canAddWindow,
  changeKind,
  changeMode,
  deleteRule,
  deleteRuleCopy,
  fromRule,
  managedNetworks as managedNetworksOf,
  removeDomain,
  removeWindow,
  ruleEditorBack,
  ruleEditorParams,
  ruleEditorState,
  saveRule,
  toggleRuleGroup,
  toggleRuleNetwork,
  toggleWindowDay,
  undoRemoveWindow,
  updateWindow,
  validateRuleDraft,
  windowTimeLabels,
  windowTitle,
  type EditWindow,
  type EditorDraft as Draft,
} from "@/lib/rule-editor";
import type { RuleWrite } from "@/lib/rule-writes";
import { CURATED_CATEGORY_SLOTS, catalogLabel, MAX_RULE_NAME, MAX_WINDOW_NAME, type Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { CategoryGlyph } from "@/components/ui/CategoryGlyph";
import { TextField, TimeField } from "@/components/ui/Controls";
import { DayPicker } from "@/components/ui/DayPicker";
import { Segmented } from "@/components/ui/Segmented";
import { RuleBar } from "@/ui/RuleBar";

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

export function RuleEditorPage({ params, searchParams }: { params?: Params; searchParams: Search }) {
  const id = params ? use(params).id : null;
  const search = use(searchParams);
  const { rules, loading } = useAppData();
  const rule = id ? rules.find((item) => item.id === id) : undefined;
  if (id && !rule) {
    if (loading) return null;
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">{COPY.notFound}</p>;
  }
  return (
    <RuleEditor
      key={rule?.id ?? "new"}
      saved={rule ?? null}
      initial={rule ? fromRule(rule) : blankDraft(ruleEditorParams(search))}
      returnGroup={one(search.group) ?? null}
    />
  );
}

function RuleEditor({ saved, initial, returnGroup }: { saved: Rule | null; initial: Draft; returnGroup: string | null }) {
  const router = useRouter();
  const { groups, unifi, store, busy } = useAppData();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState("");
  const [domainDraft, setDomainDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = (next: (current: Draft) => Draft) => {
    setError("");
    setDraft(next);
  };
  const set = (patch: Partial<Draft>) => edit((current) => ({ ...current, ...patch }));
  const setWindow = (key: string, patch: Partial<Pick<EditWindow, "name" | "start" | "end">>) => edit((current) => updateWindow(current, key, patch));

  const { href: back, label: backLabel } = ruleEditorBack(returnGroup, groups);
  const { title, summary, scheduled, windows: liveWindows, policyNames, writes, overlaps, dirty } = ruleEditorState(draft, saved);
  const managedNetworks = managedNetworksOf(unifi);

  async function save() {
    if (busy) return;
    const problem = validateRuleDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const result = await saveRule(store.mutate, draft, saved);
    if (result?.rule) router.push(back);
  }

  async function remove() {
    if (!saved) return;
    const result = await deleteRule(store.mutate, saved);
    if (result) router.push(back);
  }

  function addDomain() {
    const added = addDomainTo(draft, domainDraft);
    if (added.error) {
      setError(added.error);
      return;
    }
    set({ domains: added.draft.domains });
    setDomainDraft("");
  }

  return (
    <>
      <PageHeader
        title={title}
        sub={summary}
        onAction={() => void save()}
        actionLabel={saved ? COPY.save : COPY.create}
        secondary={
          saved ? (
            <button
              type="button"
              className="rounded-lg px-3.5 py-2 text-[14px] font-semibold"
              style={{ background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }}
              onClick={() => setConfirmDelete(true)}
            >
              {COPY.deleteRule}
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
          {saved && dirty ? <span className="text-[14px] text-[var(--ff-paused)]">{COPY.unsaved}</span> : null}
        </div>
        {error ? (
          <p role="alert" className="rounded-[9px] px-3 py-2 text-[14px]" style={{ background: "var(--ff-danger-fill)", color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}

        <Section title={COPY.name.title} note={COPY.name.note}>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-ink-3)]">
            {COPY.name.label}
            <TextField label={COPY.name.label} value={draft.name} onChange={(name) => set({ name })} placeholder={COPY.name.placeholder} maxLength={MAX_RULE_NAME} />
          </label>
          <div className="rounded-[9px] bg-[var(--ff-field-soft)] p-3">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[14px] font-semibold">
                {policyNames.length > 1 ? COPY.policyNames.many : COPY.policyNames.one}
              </span>
              <button
                type="button"
                className="text-[14px] font-semibold text-[var(--ff-accent)]"
                onClick={() => set({ useGeneratedName: !draft.useGeneratedName })}
              >
                {draft.useGeneratedName ? COPY.policyNames.useRuleName : COPY.policyNames.useGenerated}
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
              {policyNames.length > 1 ? COPY.policyNames.manyNote : COPY.policyNames.oneNote}
            </p>
          </div>
        </Section>

        <Section title={COPY.blocks.title} note={KIND_NOTE[draft.kind]}>
          <Segmented
            name={COPY.blocks.title}
            grow
            value={draft.kind}
            segments={KINDS.map((item) => ({ ...item, disabled: Boolean(saved) && item.value !== draft.kind }))}
            onChange={(kind) => edit((current) => changeKind(current, kind))}
          />
          {saved ? <p className="text-[14px] text-[var(--ff-ink-2)]">{COPY.blocks.savedKind}</p> : null}
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
                      onClick={() => edit((current) => removeDomain(current, domain))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className="min-w-[180px] flex-1">
                  <TextField label={COPY.domains.label} value={domainDraft} onChange={setDomainDraft} onSubmit={addDomain} placeholder={COPY.domains.placeholder} mono />
                </div>
              </div>
              <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">
                {COPY.domains.note}
              </p>
            </div>
          ) : null}
        </Section>

        <Section title={COPY.when.title} note={COPY.when.note}>
          <Segmented
            name={COPY.when.title}
            value={draft.mode}
            segments={[
              { value: "always", label: COPY.when.always },
              { value: "scheduled", label: COPY.when.scheduled },
            ]}
            onChange={(mode) => edit((current) => changeMode(current, mode))}
          />
          {!scheduled ? (
            <p className="text-[14px] text-[var(--ff-ink-2)]">{COPY.when.alwaysNote}</p>
          ) : (
            <>
              <RuleBar rule={{ kind: draft.kind, mode: "scheduled", windows: liveWindows }} />
              {draft.windows.map((window) => {
                const index = liveWindows.indexOf(window);
                if (window.removed) {
                  return (
                    <div key={window.key} className="flex items-center gap-2 rounded-[9px] bg-[var(--ff-field-soft)] px-3 py-2 text-[14px]">
                      <span className="flex-1">
                        <span className="line-through">{window.name || "Window"}</span> · {COPY.when.removed}
                      </span>
                      <button type="button" className="font-semibold text-[var(--ff-accent)]" onClick={() => edit((current) => undoRemoveWindow(current, window.key))}>
                        {COPY.when.undo}
                      </button>
                    </div>
                  );
                }
                return (
                  <fieldset key={window.key} className="m-0 flex flex-col gap-2.5 rounded-[9px] border border-[var(--ff-hairline-card)] p-3">
                    <legend className="sr-only">{windowTitle(window, index)}</legend>
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
                      {saved && !window.id ? <span className="flex-none text-[14px] text-[var(--ff-on)]">{COPY.when.newWindow}</span> : null}
                      {liveWindows.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Remove ${window.name || `window ${index + 1}`}`}
                          className="flex h-7 w-7 flex-none items-center justify-center rounded-[6px] text-[17px] text-[var(--ff-danger)]"
                          onClick={() => edit((current) => removeWindow(current, window.key))}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <TimeField label={windowTimeLabels(draft.kind).start} value={window.start} onChange={(start) => setWindow(window.key, { start })} />
                      <TimeField label={windowTimeLabels(draft.kind).end} value={window.end} onChange={(end) => setWindow(window.key, { end })} />
                      <DayPicker
                        days={window.days}
                        onToggle={(day) => edit((current) => toggleWindowDay(current, window.key, day))}
                      />
                    </div>
                    {liveWindows.length === 1 ? (
                      <p className="text-[14px] text-[var(--ff-ink-2)]">{COPY.when.lastWindow}</p>
                    ) : null}
                  </fieldset>
                );
              })}
              {overlaps.length ? (
                <p role="status" className="rounded-[9px] bg-[var(--ff-paused-fill)] px-3 py-2 text-[14px] leading-5">
                  {overlaps.join(" ")} {COPY.when.overlap}
                </p>
              ) : null}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!canAddWindow(draft)}
                  className="text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-50"
                  onClick={() => edit(addWindow)}
                >
                  {COPY.when.add}
                </button>
                <span className="text-[14px] text-[var(--ff-ink-2)]">{COPY.when.addNote}</span>
              </div>
            </>
          )}
        </Section>

        <Section title={COPY.appliesTo.title} note={COPY.appliesTo.note}>
          {managedNetworks.length ? (
            <Segmented
              name={COPY.appliesTo.title}
              value={draft.scope}
              segments={[
                { value: "group", label: COPY.appliesTo.groups, disabled: Boolean(saved) && draft.scope !== "group" },
                {
                  value: "network",
                  label: COPY.appliesTo.networks,
                  disabled: draft.kind === "internet" || (Boolean(saved) && draft.scope !== "network"),
                },
              ]}
              onChange={(scope) => set({ scope })}
            />
          ) : null}
          {draft.kind === "internet" ? (
            <p className="text-[14px] text-[var(--ff-ink-2)]">{COPY.appliesTo.internetNote}</p>
          ) : null}
          {draft.scope === "group" ? (
            <ChipGroup label={COPY.appliesTo.groupsLabel}>
              {groups.map((group) => {
                const on = draft.groupIds.includes(group.id);
                return (
                  <Chip
                    key={group.id}
                    on={on}
                    onClick={() => edit((current) => toggleRuleGroup(current, group.id))}
                  >
                    {group.name}
                  </Chip>
                );
              })}
            </ChipGroup>
          ) : (
            <ChipGroup label={COPY.appliesTo.networksLabel}>
              {managedNetworks.map((network) => {
                const on = draft.networkIds.includes(network.id);
                return (
                  <Chip
                    key={network.id}
                    on={on}
                    onClick={() => edit((current) => toggleRuleNetwork(current, network.id))}
                  >
                    {network.name}
                  </Chip>
                );
              })}
            </ChipGroup>
          )}
        </Section>

        <Section title={COPY.writes.title} note={COPY.writes.note}>
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
                {deleteRuleCopy(saved).title}
              </h2>
              <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">{deleteRuleCopy(saved).message}</p>
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
                {deleteRuleCopy(saved).cancel}
              </button>
              <button
                type="button"
                className="flex-1 border-l border-[var(--ff-hairline-card)] py-3 text-[14px] font-semibold text-[var(--ff-danger)]"
                onClick={() => void remove()}
              >
                {deleteRuleCopy(saved).confirm}
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

/**
 * The categories or apps a rule blocks, picked the way websites are: the box holds only
 * what is picked, and a search asks the gateway's catalog (`?filter=`) for matches to add.
 * Nothing is listed by hand, so whatever the gateway supports can be found.
 */
function CatalogPicker({ kind, targetIds, onChange }: { kind: "category" | "app"; targetIds: number[]; onChange: (ids: number[]) => void }) {
  const copy = catalogCopy(kind);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; items: CatalogItem[] }>({ query: "", items: [] });
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState("");
  const remember = (items: CatalogItem[]) => setNames((current) => new Map([...current, ...items.map((item) => [item.id, item.name] as const)]));
  const fetchCatalog = (filter: string) => searchCatalog(request, kind, filter);

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
          setResults({ query: filter, items: items.slice(0, CATALOG_RESULTS_SHOWN) });
          setError("");
        })
        .catch(() => {
          if (!cancelled) setError(copy.failed);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filter = query.trim();
  const found = filter && results.query === filter ? results.items : [];
  // The gateway knows "Video" as "Media streaming", so a familiar name matches too.
  const matches = catalogMatches(kind, filter, found, targetIds);
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
            label={copy.search}
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              if (matches[0]) add(matches[0].id);
            }}
            placeholder={copy.placeholder}
          />
        </div>
      </div>
      {matches.length ? (
        <ChipGroup label={copy.matches}>
          {matches.map((item) => (
            <Chip key={item.id} on={false} tone="rule" onClick={() => add(item.id)}>
              {slot(item.id) ? <CategoryGlyph slot={slot(item.id)!.slot} size={13} /> : null}
              {label(item.id)}
            </Chip>
          ))}
        </ChipGroup>
      ) : filter && results.query === filter && !error && !catalogFamiliar(kind, filter).length ? (
        <p className="text-[14px] text-[var(--ff-ink-2)]">{copy.none(filter)}</p>
      ) : null}
      {error ? <p className="text-[14px] text-[var(--ff-danger)]">{error}</p> : null}
      <p className="text-[14px] leading-5 text-[var(--ff-ink-2)]">
        {copy.note}
      </p>
    </div>
  );
}

