/**
 * First-time setup: the five steps a new household walks through after its first sign-in, and the
 * writes each one sends. Every write is an existing API call (the gateway, groups and rules), so
 * setup is a guided path over Settings and Rules, not a separate store.
 */
import type { ApiRequest } from "./api-client";
import { CURATED_CATEGORY_SLOTS } from "./rules";
import { daysLabel, windowTimes } from "./display";
import type { Group, UnifiNetwork, UnifiSettings } from "./types";

export type FamilyRole = NonNullable<Group["familyRole"]>;

export const SETUP_STEP_COUNT = 5;

/** Steps 0–4 are the work; step 5 is the summary. */
export const SETUP_LEDES = [
  "Welcome. Let’s set up your household.",
  "Point FamilyFi at your UniFi gateway.",
  "Choose what FamilyFi watches.",
  "Who lives here?",
  "Start with a few common schedules.",
  "You’re all set.",
] as const;

/** A person on the household step. `id` is set once their family group exists, so a retry never adds them twice. */
export type SetupMember = { id?: string; name: string; role: FamilyRole; savedRole?: FamilyRole };

type Window = { days: number[]; start: string; end: string };
type SuggestedRule = { name: string; roles: FamilyRole[]; window: Window };

export type ScheduleSuggestion = {
  id: string;
  name: string;
  what: string;
  kind: "internet" | "category";
  targetIds: number[];
  rules: SuggestedRule[];
  /** Turned on until the household says otherwise. */
  on: boolean;
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const SCHOOL_DAYS = [1, 2, 3, 4, 5];

function categoryIds(...slots: string[]): number[] {
  return slots.map((slot) => {
    const found = CURATED_CATEGORY_SLOTS.find((item) => item.slot === slot);
    if (!found) throw new Error(`Unknown category slot ${slot}`);
    return found.categoryId;
  });
}

/** Common starting points for teens and children. Each becomes one rule per distinct window. */
export const SCHEDULE_SUGGESTIONS: readonly ScheduleSuggestion[] = [
  {
    id: "bedtime",
    name: "Bedtime",
    what: "Internet off on their devices",
    kind: "internet",
    targetIds: [],
    rules: [
      { name: "Children’s bedtime", roles: ["child"], window: { days: EVERY_DAY, start: "20:30", end: "07:00" } },
      { name: "Teens’ bedtime", roles: ["teen"], window: { days: EVERY_DAY, start: "22:00", end: "06:30" } },
    ],
    on: true,
  },
  {
    id: "homework",
    name: "Homework",
    what: "Games, video and social blocked",
    kind: "category",
    targetIds: categoryIds("gaming", "video", "social"),
    rules: [{ name: "Homework", roles: ["teen", "child"], window: { days: SCHOOL_DAYS, start: "16:00", end: "18:00" } }],
    on: true,
  },
  {
    id: "dinner",
    name: "Dinner",
    what: "Internet off on their devices",
    kind: "internet",
    targetIds: [],
    rules: [{ name: "Dinner", roles: ["teen", "child"], window: { days: EVERY_DAY, start: "18:00", end: "19:00" } }],
    on: false,
  },
  {
    id: "mornings",
    name: "School mornings",
    what: "Games and video blocked",
    kind: "category",
    targetIds: categoryIds("gaming", "video"),
    rules: [{ name: "School mornings", roles: ["child"], window: { days: SCHOOL_DAYS, start: "07:00", end: "08:00" } }],
    on: false,
  },
];

const ROLE_PLURAL: Record<FamilyRole, string> = { adult: "Adults", teen: "Teens", child: "Children" };

/** "Every day · Children 8:30 PM–7 AM · Teens 10 PM–6:30 AM", or "Mon–Fri · 4 PM–6 PM" for one window. */
export function suggestionTimes(suggestion: ScheduleSuggestion): string {
  const days = daysLabel(suggestion.rules[0]?.window.days ?? []);
  if (suggestion.rules.length === 1) {
    const { start, end } = suggestion.rules[0].window;
    return `${days} · ${windowTimes(start, end)}`;
  }
  const parts = suggestion.rules.map((rule) => `${ROLE_PLURAL[rule.roles[0]]} ${windowTimes(rule.window.start, rule.window.end)}`);
  return [days, ...parts].join(" · ");
}

function membersFor(members: readonly SetupMember[], roles: readonly FamilyRole[]): SetupMember[] {
  return members.filter((member) => roles.includes(member.role));
}

/** Who a suggestion would cover, as the row says it. */
export function suggestionAppliesTo(suggestion: ScheduleSuggestion, members: readonly SetupMember[]): string {
  const roles = suggestion.rules.flatMap((rule) => rule.roles);
  const names = membersFor(members, roles).map((member) => member.name);
  return names.length ? `For ${names.join(", ")}` : "No one this applies to yet";
}

export function suggestionApplies(suggestion: ScheduleSuggestion, members: readonly SetupMember[]): boolean {
  return membersFor(members, suggestion.rules.flatMap((rule) => rule.roles)).length > 0;
}

export type RuleCreate = {
  name: string;
  kind: "internet" | "category";
  scope: "group";
  groupIds: string[];
  targetIds: number[];
  mode: "scheduled";
  windows: { name: string; days: number[]; start: string; end: string }[];
};

/**
 * The `POST /api/v1/rules` bodies for one suggestion: one rule per window that has someone to
 * cover, over the family groups of the roles it names. Members must already have their group ids.
 */
export function suggestionRules(suggestion: ScheduleSuggestion, members: readonly SetupMember[]): RuleCreate[] {
  return suggestion.rules.flatMap((rule) => {
    const groupIds = membersFor(members, rule.roles).flatMap((member) => (member.id ? [member.id] : []));
    if (!groupIds.length) return [];
    return [
      {
        name: rule.name,
        kind: suggestion.kind,
        scope: "group" as const,
        groupIds,
        targetIds: suggestion.targetIds,
        mode: "scheduled" as const,
        windows: [{ name: "", ...rule.window }],
      },
    ];
  });
}

/** The networks a new selection starts with: what is saved, else every network on the site. */
export function initialNetworkSelection(unifi: Pick<UnifiSettings, "configured" | "manageAllNetworks" | "managedNetworkIds"> | null, networks: readonly UnifiNetwork[]): string[] {
  if (unifi?.configured && !unifi.manageAllNetworks) return networks.filter((network) => unifi.managedNetworkIds.includes(network.id)).map((network) => network.id);
  return networks.map((network) => network.id);
}

/**
 * The selection as `PUT /api/v1/settings/unifi` takes it. Setup names networks one by one, so a
 * network added on the gateway later is not watched until someone picks it, except where the
 * household already watched every network and still does.
 */
export function networkSelectionBody(
  unifi: Pick<UnifiSettings, "configured" | "manageAllNetworks"> | null,
  networks: readonly UnifiNetwork[],
  selected: readonly string[],
): { manageAllNetworks: boolean; managedNetworkIds: string[] } {
  const everything = networks.length > 0 && networks.every((network) => selected.includes(network.id));
  if (unifi?.configured && unifi.manageAllNetworks && everything) return { manageAllNetworks: true, managedNetworkIds: [] };
  return { manageAllNetworks: false, managedNetworkIds: networks.filter((network) => selected.includes(network.id)).map((network) => network.id) };
}

export type SetupFields = {
  wrote: boolean;
  /** The gateway answered a test. */
  connected: boolean;
  /** A key is saved already, so testing it needs no new one. */
  savedKey: boolean;
  host: string;
  apiKey: string;
  selectedNetworks: readonly string[];
  members: readonly SetupMember[];
};

/** Why a step cannot continue yet, or null when it can. */
export function setupStepError(step: number, fields: SetupFields): string | null {
  if (step === 0 && !fields.wrote) return "Confirm you’ve written down where the recovery password is.";
  if (step === 1 && !fields.connected && !fields.savedKey) {
    if (!fields.host.trim()) return "Enter your gateway’s IP address or hostname.";
    if (!fields.apiKey.trim()) return "Paste an API key to continue.";
  }
  if (step === 2 && fields.selectedNetworks.length === 0) return "Pick at least one network.";
  if (step === 3 && !fields.members.some((member) => member.role === "adult")) return "Add at least one adult.";
  return null;
}

/** The button that moves a step on. */
export function setupCta(step: number, connected: boolean): string {
  if (step === 1 && !connected) return "Test connection";
  if (step === 4) return "Finish setup";
  if (step === 5) return "Open FamilyFi";
  return "Continue";
}

export function setupFoot(step: number): string {
  return step === 4
    ? "You can change times, add rules and assign devices any time in Rules."
    : "You can change all of this later in Settings.";
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Saves the household step: a family group for each new person, and each changed role. It stops at
 * the first failure; everyone saved before it comes back with their id, so trying again never adds
 * them twice.
 */
export async function saveMembers(request: ApiRequest, members: readonly SetupMember[]): Promise<{ members: SetupMember[]; error: string | null }> {
  const next = [...members];
  try {
    for (const [index, member] of next.entries()) {
      if (!member.id) {
        const result = await request<{ group: { id: string } }>("/api/v1/groups", {
          method: "POST",
          body: { kind: "family", name: member.name, familyRole: member.role },
        });
        next[index] = { ...member, id: result.group.id, savedRole: member.role };
      } else if (member.role !== member.savedRole) {
        await request(`/api/v1/groups/${member.id}`, { method: "PUT", body: { familyRole: member.role } });
        next[index] = { ...member, savedRole: member.role };
      }
    }
    return { members: next, error: null };
  } catch (error) {
    return { members: next, error: failure(error) };
  }
}

/** A rule setup made, by name, and who it covered. */
export type CreatedRules = Readonly<Record<string, { id: string; groupIds: readonly string[] }>>;

/**
 * Creates the rules for the suggestions that are on. A rule made on an earlier try is not made
 * again; anyone it should now cover is added to it instead, and nobody is taken off it. It stops at the
 * first failure and returns what it made.
 */
export async function saveSchedules(
  request: ApiRequest,
  suggestions: readonly ScheduleSuggestion[],
  members: readonly SetupMember[],
  created: CreatedRules,
): Promise<{ created: CreatedRules; error: string | null }> {
  const next: Record<string, { id: string; groupIds: readonly string[] }> = { ...created };
  try {
    for (const suggestion of suggestions) {
      for (const body of suggestionRules(suggestion, members)) {
        const made = next[body.name];
        if (!made) {
          const result = await request<{ rule: { id: string } }>("/api/v1/rules", { method: "POST", body });
          next[body.name] = { id: result.rule.id, groupIds: body.groupIds };
        } else if (body.groupIds.some((id) => !made.groupIds.includes(id))) {
          // Adds whoever is missing and keeps everyone the rule already covers, such as a group added in Rules.
          const groupIds = [...made.groupIds, ...body.groupIds.filter((id) => !made.groupIds.includes(id))];
          await request(`/api/v1/rules/${made.id}`, { method: "PATCH", body: { groupIds } });
          next[body.name] = { id: made.id, groupIds };
        }
      }
    }
    return { created: next, error: null };
  } catch (error) {
    return { created: next, error: failure(error) };
  }
}

/**
 * The suggested rules the household already has, by name, so running setup again brings them up to
 * date rather than making a second rule of the same name.
 */
export function existingSuggestedRules(rules: readonly { id: string; name: string; groupIds: readonly string[] }[]): CreatedRules {
  const names = new Set(SCHEDULE_SUGGESTIONS.flatMap((suggestion) => suggestion.rules.map((rule) => rule.name)));
  return Object.fromEntries(rules.filter((rule) => names.has(rule.name)).map((rule) => [rule.name, { id: rule.id, groupIds: rule.groupIds }]));
}
