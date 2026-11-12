import { groupBadge, groupStatusParts, internetRulePath } from "./group-actions";
import type { Rule } from "./rules";
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
 * phone unlocked.
 */
export function blockSwitchWrite(group: Pick<Group, "id">, turnOn: boolean): { path: string; needsUnlock: boolean } {
  return turnOn
    ? { path: `${internetRulePath(group)}/pause`, needsUnlock: false }
    : { path: `/api/v1/groups/${group.id}/unblock`, needsUnlock: true };
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
  added: "Added to Quick Settings.",
  alreadyAdded: "This tile is already in Quick Settings.",
  addYourself: "Swipe down twice from the top of your screen, tap the pencil, then drag FamilyFi Block into your tiles.",
  /** The server is older than the first contract with a sign-in for tiles. */
  needsUpdate: "Update your FamilyFi server to use Quick Settings tiles.",
  /** The tiles are not signed in yet: the app does that once it has read the household. */
  settingUp: "Setting up Quick Settings tiles…",
} as const;
