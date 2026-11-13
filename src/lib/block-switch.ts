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
