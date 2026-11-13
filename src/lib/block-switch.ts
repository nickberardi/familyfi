import { formatClock } from "./display";
import { groupBadge, groupStatusParts, internetRulePath, rulesBlockingGroup, rulesToUnblock } from "./group-actions";
import { CURATED_CATEGORY_SLOTS, type Rule } from "./rules";
import type { Group } from "./types";

/**
 * A group's one-tap Block switch outside the app: a Quick Settings tile on Android, a Control Center
 * control on iPhone. It is on while the group's card badge reads Blocked, so a switch and a card
 * never disagree, and it has no timed choices: those stay in the app. Native code cannot run this
 * TypeScript, so each platform keeps a copy and replays `tests/fixtures/display-vectors.json`.
 */

/** How many Quick Settings tiles an Android phone offers: Android has one tile per service, so the number is fixed. */
export const QUICK_SETTINGS_TILES = 3;

/** Whether the switch is on, and the word under the group's name (the card badge's own). */
export function blockSwitch(group: Group, rules: Rule[], timezone: string, now: Date): { on: boolean; state: string } {
  const { badge } = groupStatusParts(group, rules, timezone, now);
  return { on: badge === "blocked", state: groupBadge(badge).label };
}

/**
 * The write a tap sends, with an empty body. Turning the switch on blocks the group until someone
 * unblocks it. Turning it off is the group's unblock, which ends its block and allows each rule
 * blocking it now until that rule's window ends; only that lifts a block, so only that needs the
 * phone unlocked. `needsUnlock` is what the write itself needs: a platform whose switch has one action
 * for both ways (the iPhone's Control Center control) asks for the unlock to block as well.
 */
export function blockSwitchWrite(group: Pick<Group, "id">, turnOn: boolean): { path: string; needsUnlock: boolean } {
  return turnOn
    ? { path: `${internetRulePath(group)}/pause`, needsUnlock: false }
    : { path: `/api/v1/groups/${group.id}/unblock`, needsUnlock: true };
}

/**
 * What Unblock outside the app does for a group now, and the words it answers with (what Siri says,
 * and Shortcuts shows). Unblock is the group's unblock (`blockSwitchWrite` off): it ends the group's
 * block and lifts each rule blocking it now until that rule's window ends, but never an always-on
 * category, app or website rule, which is how the group is set up (`standingRule`). So with the
 * internet on and Video always blocked, there is nothing for it to do: `send` is false, and the
 * answer says so and why, instead of a bare "unblocked" that Video would contradict. A parent
 * changes an always-on rule in the app. A block that has already ended counts as none.
 */
export function unblockAnswer(group: Group, rules: Rule[], timezone: string, now: Date): { send: boolean; say: string } {
  const lifts = rulesToUnblock(group, rules, timezone, now);
  const liftIds = new Set(lifts.map((rule) => rule.ruleId));
  const standing = rulesBlockingGroup(group, rules, timezone, now)
    .filter((rule) => !liftIds.has(rule.ruleId))
    .flatMap(({ ruleId }) => rules.filter((rule) => rule.id === ruleId));
  const kept = standing.length ? ` ${standingClause(standing)}.` : "";
  const { active, until: pauseEnd } = group.suspension;
  const paused = active && (pauseEnd === null || Date.parse(pauseEnd) > now.getTime());
  if (!paused && lifts.length === 0) {
    const change = standing.length ? " You can change that in FamilyFi." : "";
    return { send: false, say: `${group.name} isn't blocked, so there's nothing to unblock.${kept}${change}` };
  }
  // Each lifted rule comes back when its window ends; the group is online until the last of them.
  const open = lifts.some((rule) => rule.until === null);
  const last = open || lifts.length === 0 ? null : new Date(Math.max(...lifts.map((rule) => Date.parse(rule.until!))));
  const until = last ? ` until ${formatClock(last, timezone)}` : "";
  return { send: true, say: `${group.name} is unblocked${until}.${kept}` };
}

/**
 * What the always-on rules keep doing, as a parent hears it: "Video and Gaming stay blocked" for
 * categories FamilyFi knows by a familiar name, and a rule by its own name otherwise ("The “No
 * TikTok” rule stays on"), which names the rule, never what it blocks.
 */
function standingClause(standing: Rule[]): string {
  const blocked: string[] = [];
  const named: string[] = [];
  for (const rule of standing) {
    const labels = (rule.targetIds ?? []).map((id) => CURATED_CATEGORY_SLOTS.find((slot) => slot.categoryId === id)?.label);
    if (rule.kind === "category" && labels.length > 0 && labels.every(Boolean)) blocked.push(...(labels as string[]));
    else named.push(`“${rule.name}”`);
  }
  const things = [...new Set(blocked)];
  const rulesNamed = [...new Set(named)];
  const parts = [
    things.length ? `${listNames(things)} ${things.length === 1 ? "stays" : "stay"} blocked` : "",
    rulesNamed.length ? `the ${listNames(rulesNamed)} ${rulesNamed.length === 1 ? "rule stays" : "rules stay"} on` : "",
  ].filter(Boolean);
  // Siri says it aloud, so the reason is short: an unblock never turns off a rule that is always on.
  const one = things.length + rulesNamed.length === 1;
  const clause = `${parts.join(" and ")}, since ${one ? "it's" : "they're"} always on`;
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}

/** "Video", "Video and Gaming", "Video, Gaming and Social". */
function listNames(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** A Quick Settings tile's own words: its names in Android's tile editor, and the line under a tile. */
export function quickSettingsTileCopy() {
  return {
    /** Each tile's name before the app gives it its group's name, in order. */
    names: Array.from({ length: QUICK_SETTINGS_TILES }, (_, index) => (index === 0 ? "FamilyFi Block" : `FamilyFi Block ${index + 1}`)),
    /** No sign-in or no group yet: a tap opens the app. */
    setUp: "Tap to set up",
    applying: "Applying…",
    failed: "Couldn't reach FamilyFi",
    /** An unblock asked for on the lock screen, when the phone was still locked after the PIN prompt. */
    stillLocked: "Unlock to unblock",
  };
}

/** The app's Quick Settings screen, where each tile gets its group. */
export const QUICK_SETTINGS_COPY = {
  title: "Quick Settings",
  section: "Block from Quick Settings",
  intro:
    "Add a Block switch for a group to Quick Settings, and block or unblock it without opening FamilyFi. Blocking works from the lock screen. Unblocking asks you to unlock first.",
  tiles: "Tiles",
  tile: (number: number) => `Tile ${number}`,
  noGroup: "No group",
  choose: "Choose a group",
  change: "Change",
  clear: "Clear",
  add: "Add to Quick Settings",
  /** What a screen reader says for each row's button, which shows only its verb. */
  chooseFor: (number: number) => `Choose a group for Tile ${number}`,
  changeFor: (number: number) => `Change group for Tile ${number}`,
  clearFor: (number: number) => `Clear Tile ${number}`,
  addFor: (number: number) => `Add Tile ${number} to Quick Settings`,
  added: "Added to Quick Settings.",
  alreadyAdded: "This tile is already in Quick Settings.",
  /** Android could not offer to add the tile: the person adds it from Quick Settings' own edit view, where it carries its slot's name. */
  addYourself: (number: number) =>
    `Open Quick Settings, open its edit view, then drag ${quickSettingsTileCopy().names[number - 1]} into your tiles.`,
  /** The household has no groups to choose from. */
  noGroups: "No groups yet.",
  /** The server is older than the first contract with a sign-in for tiles. */
  needsUpdate: "To use Quick Settings tiles, update your FamilyFi server from Settings on your computer.",
  /** The tiles are not signed in yet: the app does that once it has read the household. */
  settingUp: "Setting up Quick Settings tiles…",
} as const;

/**
 * The iPhone's Block control's own words, in the controls gallery and its settings. A control has one
 * action, which asks for the device to be unlocked both ways, so they promise no single tap.
 */
export const BLOCK_CONTROL_COPY = {
  /** Its name in the gallery, and its title before a group is chosen. */
  name: "Block internet",
  description: "Block or unblock a group from Control Center.",
  /** What the system asks when the control is added. */
  configure: "Choose the group this switch blocks and unblocks.",
} as const;
