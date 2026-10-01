/**
 * The rule editor every client shows: the draft it edits, each edit, what it checks before saving,
 * what it sends, and its copy. A draft keeps a removed window until it is saved, so the window can
 * come back.
 */
import type { HouseholdStore } from "./household-store";
import { rulePolicyNames } from "./policy-names";
import { overlapNotices, ruleWritePlan, type RuleDraft, type RuleWrite } from "./rule-writes";
import { MAX_RULE_NAME, MAX_RULE_WINDOWS, normalizeDomain, type Rule, type RuleKind, type RuleWindow } from "./rules";
import type { Group } from "./types";

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export const RULE_KINDS: readonly { value: RuleKind; label: string }[] = [
  { value: "internet", label: "All internet" },
  { value: "category", label: "Categories" },
  { value: "app", label: "Apps" },
  { value: "domain", label: "Websites" },
];

export const KIND_NOTE: Record<RuleKind, string> = {
  internet: "Every site and app on every device in the chosen groups.",
  category: "Only this category. Everything else stays on.",
  app: "Only these apps, matched by the gateway’s app detection. Everything else stays on.",
  domain: "Only these websites and their subdomains. Everything else stays on.",
};

/** A new rule's first window: overnight, every day. */
export const DEFAULT_WINDOW: RuleWindow = { name: "", days: EVERY_DAY, start: "21:00", end: "07:00" };
/** "Add window": after school on weekdays. */
export const NEW_WINDOW: RuleWindow = { name: "", days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00" };

/** A window being edited: `key` tells rows apart before a new window has an id. */
export type EditWindow = RuleWindow & { key: string; removed?: boolean };
export type EditorDraft = Omit<RuleDraft, "windows"> & {
  scope: "group" | "network";
  networkIds: string[];
  enabled: boolean;
  windows: EditWindow[];
};

let nextKey = 0;
export function keyed(window: RuleWindow): EditWindow {
  return { ...window, days: [...window.days], key: window.id ?? `new-${nextKey++}` };
}

export function fromRule(rule: Rule): EditorDraft {
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

/** What a link into the editor can start a new rule with. */
export type RuleEditorParams = { kind: RuleKind; group?: string; target?: number; name?: string; domains?: string };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A new rule's starting point from a link's query: `kind`, `group`, `target`, `name` and comma-separated `domains`. */
export function ruleEditorParams(search: Record<string, string | string[] | undefined>): RuleEditorParams {
  const kindParam = one(search.kind);
  const kind = RULE_KINDS.find((item) => item.value === kindParam)?.value ?? "internet";
  const target = one(search.target) ? Number(one(search.target)) : undefined;
  return {
    kind,
    ...(one(search.group) ? { group: one(search.group) } : {}),
    ...(target !== undefined && Number.isFinite(target) ? { target } : {}),
    ...(one(search.name) !== undefined ? { name: one(search.name) } : {}),
    ...(one(search.domains) !== undefined ? { domains: one(search.domains) } : {}),
  };
}

/** A new rule: all internet starts scheduled with one overnight window; anything narrower starts always on. */
export function blankDraft(params: RuleEditorParams): EditorDraft {
  const { kind } = params;
  const scheduled = kind === "internet";
  const domains =
    kind === "domain" && params.domains
      ? params.domains
          .split(",")
          .map(normalizeDomain)
          .filter((item): item is string => Boolean(item))
      : [];
  return {
    id: "",
    name: (params.name ?? "").slice(0, MAX_RULE_NAME),
    useGeneratedName: false,
    kind,
    scope: "group",
    targetIds: kind === "category" && params.target !== undefined ? [params.target] : [],
    domains: [...new Set(domains)],
    groupIds: params.group ? [params.group] : [],
    networkIds: [],
    enabled: true,
    mode: scheduled ? "scheduled" : "always",
    windows: scheduled ? [keyed(DEFAULT_WINDOW)] : [],
  };
}

/** The draft as it would be saved: removed windows dropped, and none at all while always on. */
export function liveDraft(draft: EditorDraft): RuleDraft {
  return {
    ...draft,
    windows:
      draft.mode === "scheduled"
        ? draft.windows.filter((window) => !window.removed).map(({ id, name, days, start, end }) => ({ id, name, days, start, end }))
        : [],
  };
}

/** The windows still in the draft. */
export function liveWindows(draft: EditorDraft): EditWindow[] {
  return draft.windows.filter((window) => !window.removed);
}

/** The first thing stopping the draft from saving, or null. */
export function validateRuleDraft(draft: EditorDraft): string | null {
  const scheduled = draft.mode === "scheduled";
  const windows = liveWindows(draft);
  if (!draft.name.trim()) return "Give the rule a name.";
  if (draft.scope === "group" && draft.groupIds.length === 0) return "Pick at least one person or thing it applies to.";
  if (draft.scope === "network" && draft.networkIds.length === 0) return "Pick at least one network.";
  if (draft.kind === "domain" && draft.domains.length === 0) return "Add at least one website.";
  if ((draft.kind === "app" || draft.kind === "category") && draft.targetIds.length === 0) {
    return draft.kind === "app" ? "Pick at least one app." : "Pick at least one category.";
  }
  if (scheduled && windows.length === 0) return "Add at least one window.";
  if (scheduled && windows.some((window) => window.days.length === 0)) return "Each window needs at least one day.";
  if (scheduled && windows.some((window) => window.start === window.end)) return "A window cannot start and end at the same time.";
  return null;
}

/** What saving sends: a PATCH of the saved rule, or a POST that also fixes the new rule's kind and scope. */
export function ruleSaveBody(draft: EditorDraft, saved: Pick<Rule, "id"> | null) {
  const current = liveDraft(draft);
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
  return saved ? body : { ...body, kind: draft.kind, scope: draft.scope, enabled: true };
}

type Mutate = HouseholdStore["mutate"];

/** Save the draft; resolves to the store's payload (with the saved `rule`), or undefined when it failed. */
export function saveRule(mutate: Mutate, draft: EditorDraft, saved: Pick<Rule, "id"> | null) {
  const body = ruleSaveBody(draft, saved);
  return mutate(
    (send) =>
      saved
        ? send<{ rule: Rule }>(`/api/v1/rules/${saved.id}`, { method: "PATCH", body })
        : send<{ rule: Rule }>("/api/v1/rules", { method: "POST", body }),
    { feedback: { notice: `${body.name} ${saved ? "saved" : "created"}. FamilyFi writes it to the gateway next.` } },
  );
}

/** Delete a rule; it leaves the list once the server agrees. */
export function deleteRule(mutate: Mutate, saved: Pick<Rule, "id" | "name">) {
  return mutate(async (send) => ({ ...(await send<object>(`/api/v1/rules/${saved.id}`, { method: "DELETE" })), removedRuleId: saved.id }), {
    feedback: { notice: `${saved.name} deleted. Its UniFi policies are removed on the next reconcile.` },
  });
}

/** Block something else: all internet is always for groups and scheduled, starting a window if none is left. */
export function changeKind(draft: EditorDraft, kind: RuleKind): EditorDraft {
  return {
    ...draft,
    kind,
    scope: kind === "internet" ? "group" : draft.scope,
    mode: kind === "internet" ? "scheduled" : draft.mode,
    targetIds: [],
    windows: kind === "internet" && draft.windows.every((window) => window.removed) ? [...draft.windows, keyed(DEFAULT_WINDOW)] : draft.windows,
  };
}

/** Always or scheduled; a scheduled rule with no window left gets the overnight one. */
export function changeMode(draft: EditorDraft, mode: EditorDraft["mode"]): EditorDraft {
  return {
    ...draft,
    mode,
    windows: mode === "scheduled" && liveWindows(draft).length === 0 ? [...draft.windows, keyed(DEFAULT_WINDOW)] : draft.windows,
  };
}

export function updateWindow(draft: EditorDraft, key: string, patch: Partial<Pick<EditWindow, "name" | "start" | "end" | "days">>): EditorDraft {
  return { ...draft, windows: draft.windows.map((window) => (window.key === key ? { ...window, ...patch } : window)) };
}

/** Turn a day on or off, keeping the days in order. */
export function toggleWindowDay(draft: EditorDraft, key: string, day: number): EditorDraft {
  const window = draft.windows.find((item) => item.key === key);
  if (!window) return draft;
  const days = window.days.includes(day) ? window.days.filter((item) => item !== day) : [...window.days, day].sort();
  return updateWindow(draft, key, { days });
}

/** A saved window is marked removed until the rule is saved, so it can be undone; an unsaved one just goes. */
export function removeWindow(draft: EditorDraft, key: string): EditorDraft {
  const window = draft.windows.find((item) => item.key === key);
  if (!window) return draft;
  if (window.id) return { ...draft, windows: draft.windows.map((item) => (item.key === key ? { ...item, removed: true } : item)) };
  return { ...draft, windows: draft.windows.filter((item) => item.key !== key) };
}

export function undoRemoveWindow(draft: EditorDraft, key: string): EditorDraft {
  return { ...draft, windows: draft.windows.map((item) => (item.key === key ? { ...item, removed: false } : item)) };
}

export function canAddWindow(draft: EditorDraft): boolean {
  return liveWindows(draft).length < MAX_RULE_WINDOWS;
}

export function addWindow(draft: EditorDraft): EditorDraft {
  return canAddWindow(draft) ? { ...draft, windows: [...draft.windows, keyed(NEW_WINDOW)] } : draft;
}

/** Add a typed website, or say why it is not one. Adding one already listed changes nothing. */
export function addDomain(draft: EditorDraft, raw: string): { draft: EditorDraft; error?: string } {
  const domain = normalizeDomain(raw);
  if (!domain) return { draft, error: `“${raw.trim()}” is not a website domain.` };
  return { draft: draft.domains.includes(domain) ? draft : { ...draft, domains: [...draft.domains, domain] } };
}

export function removeDomain(draft: EditorDraft, domain: string): EditorDraft {
  return { ...draft, domains: draft.domains.filter((item) => item !== domain) };
}

/** Add or drop a group or network from the rule. */
export function toggleRuleGroup(draft: EditorDraft, groupId: string): EditorDraft {
  const on = draft.groupIds.includes(groupId);
  return { ...draft, groupIds: on ? draft.groupIds.filter((id) => id !== groupId) : [...draft.groupIds, groupId] };
}

export function toggleRuleNetwork(draft: EditorDraft, networkId: string): EditorDraft {
  const on = draft.networkIds.includes(networkId);
  return { ...draft, networkIds: on ? draft.networkIds.filter((id) => id !== networkId) : [...draft.networkIds, networkId] };
}

/** What the editor shows of the draft: its UniFi names, what saving writes, overlapping windows and whether it changed. */
export function ruleEditorState(draft: EditorDraft, saved: Rule | null) {
  const current = liveDraft(draft);
  const windows = liveWindows(draft);
  const scheduled = draft.mode === "scheduled";
  const id = saved?.id ?? "new0";
  const policyNames = rulePolicyNames({ ...current, id });
  const writes: RuleWrite[] = ruleWritePlan(saved ? liveDraft(fromRule(saved)) : null, { ...current, id });
  const summary = [
    RULE_KINDS.find((item) => item.value === draft.kind)!.label,
    scheduled ? `${windows.length} ${windows.length === 1 ? "window" : "windows"}` : "always",
    `${policyNames.length} UniFi ${policyNames.length === 1 ? "policy" : "policies"}`,
  ].join(" · ");
  return {
    title: draft.name.trim() || saved?.name || "New rule",
    summary,
    scheduled,
    windows,
    policyNames,
    writes,
    overlaps: scheduled ? overlapNotices(windows) : [],
    dirty: !saved || JSON.stringify(current) !== JSON.stringify(liveDraft(fromRule(saved))),
  };
}

/** The networks FamilyFi manages, which a rule can cover whole. */
export function managedNetworks<T extends { id: string }>(unifi: { networks: T[]; manageAllNetworks: boolean; managedNetworkIds: string[] } | null | undefined): T[] {
  return (unifi?.networks ?? []).filter((network) => unifi?.manageAllNetworks || unifi?.managedNetworkIds.includes(network.id));
}

/** Where the editor goes back to: the group's rules it came from, or every rule. */
export function ruleEditorBack(returnGroup: string | null, groups: Pick<Group, "id" | "name">[]): { href: string; label: string } {
  if (!returnGroup) return { href: "/rules", label: "All rules" };
  return { href: `/rules?group=${returnGroup}`, label: `Rules for ${groups.find((group) => group.id === returnGroup)?.name ?? "this group"}` };
}

export const RULE_EDITOR_COPY = {
  create: "Create rule",
  save: "Save",
  deleteRule: "Delete rule…",
  unsaved: "Unsaved changes",
  notFound: "Rule not found.",
  name: { title: "Name", note: "What your household calls it, and what UniFi’s policy table shows.", label: "Rule name", placeholder: "e.g. School nights" },
  policyNames: {
    one: "Name in UniFi",
    many: "Names in UniFi · one policy per window",
    useRuleName: "Use rule name",
    useGenerated: "Use generated name",
    oneNote: "Follows the rule name. With a second window each policy gets the window’s name on the end.",
    manyNote: "Rule name, then the window name. The FamilyFi prefix is fixed, so administrators can tell FamilyFi’s policies apart.",
  },
  blocks: { title: "What it blocks", savedKind: "A saved rule keeps what it blocks. Make a new rule to block something else." },
  domains: {
    label: "Add a website",
    placeholder: "Add a domain, then Enter",
    note: "Subdomains are included. The gateway matches websites by their DNS lookups, so a device using encrypted DNS can get around this.",
  },
  when: {
    title: "When",
    note: "Each window is its own UniFi policy with one schedule. Windows can cross midnight.",
    always: "Always",
    scheduled: "Scheduled",
    alwaysNote: "Blocked all day, every day. One UniFi policy.",
    removed: "removed on save.",
    undo: "Undo",
    newWindow: "New · adds 1 policy",
    lastWindow: "A scheduled rule needs at least one window. To remove it entirely, delete the rule.",
    overlap: "Both block while they overlap; access comes back when the later one ends.",
    add: "+ Add window",
    addNote: "Each window adds one UniFi policy",
  },
  appliesTo: {
    title: "Applies to",
    note: "People and things. One rule can cover several.",
    groups: "People and things",
    networks: "Whole networks",
    groupsLabel: "Groups",
    networksLabel: "Networks",
    internetNote: "All internet can’t be blocked for a whole network, which would take every device offline. Choose the people and things it applies to.",
  },
  writes: { title: "What FamilyFi will write", note: "Applied on the next reconcile. Your own UniFi policies are never touched." },
} as const;

/** A window's name, or its place in the list. */
export function windowTitle(window: Pick<RuleWindow, "name">, index: number): string {
  return window.name || `Window ${index + 1}`;
}

/** A window's two times: when internet goes off and comes back, or when the narrower block starts and ends. */
export function windowTimeLabels(kind: RuleKind): { start: string; end: string } {
  return kind === "internet" ? { start: "Offline", end: "Back on" } : { start: "Blocked", end: "Until" };
}

/** What deleting a saved rule says before it goes. */
export function deleteRuleCopy(saved: Pick<Rule, "name" | "policyNames">) {
  return {
    title: `Delete “${saved.name}”?`,
    message: `Removes ${saved.policyNames.length === 1 ? "its UniFi policy" : `all ${saved.policyNames.length} of its UniFi policies`} on the next reconcile, and discards unsaved edits. Other rules are not affected. This can’t be undone.`,
    cancel: "Cancel",
    confirm: "Delete rule",
  } as const;
}
