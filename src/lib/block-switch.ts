import { formatClock } from "./display";
import {
  groupBadge,
  groupStatus,
  internetRulePath,
  rulesBlockingGroup,
  rulesToUnblock,
} from "./group-actions";
import { groupLift, groupScopedRules, rulePaused, type Rule } from "./rules";
import type { Group } from "./types";

/**
 * A group's one-tap Block switch outside the app: a Quick Settings tile on Android, a Control Center
 * control on iPhone. It is on while the group's internet is blocked, which the card's badge says
 * unless a Block button default gives the badge to that rule (then the switch, like Siri, still
 * means all internet), and it has no timed choices: those stay in the app. Native code cannot run this
 * TypeScript, so each platform keeps a copy and replays `tests/fixtures/display-vectors.json`.
 */

/** How many Quick Settings tiles an Android phone offers: Android has one tile per service, so the number is fixed. */
export const QUICK_SETTINGS_TILES = 3;

/** Whether the switch is on, and the word under the group's name: Blocked or Online. */
export function blockSwitch(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
): { on: boolean; state: string } {
  const { tone } = groupStatus(group, rules, timezone, now);
  const on = tone === "paused" || tone === "off";
  return { on, state: groupBadge(on ? "blocked" : "online").label };
}

/**
 * The write a tap sends, with an empty body. Turning the switch on blocks the group until someone
 * unblocks it. Turning it off is the group's unblock, which ends its block and allows each rule
 * blocking it now until that rule's window ends; only that lifts a block, so only that needs the
 * phone unlocked. `needsUnlock` is what the write itself needs: a platform whose switch has one action
 * for both ways (the iPhone's Control Center control) asks for the unlock to block as well.
 */
export function blockSwitchWrite(
  group: Pick<Group, "id">,
  turnOn: boolean,
): { path: string; needsUnlock: boolean } {
  return turnOn
    ? { path: `${internetRulePath(group)}/pause`, needsUnlock: false }
    : { path: `/api/v1/groups/${group.id}/unblock`, needsUnlock: true };
}

/**
 * What Unblock outside the app does for a group now, and the words it answers with (what Siri says,
 * and Shortcuts shows). Unblock is the group's unblock (`blockSwitchWrite` off): it ends the group's
 * block and lifts each rule blocking it now until that rule's window ends, but never an always-on
 * category, app or website rule, which is how the group is set up (`standingRule`). So with the
 * internet on and only an always-on rule blocking, there is nothing for it to do: `send` is false,
 * and the answer says so and names the rule, instead of a bare "unblocked" the rule would contradict.
 * Rules go by their own names, as the card's dropdown names them ("Unblock No streaming"). A block
 * that has already ended counts as none.
 */
export function unblockAnswer(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
): UnblockAnswer {
  const lifts = rulesToUnblock(group, rules, timezone, now);
  const liftIds = new Set(lifts.map((rule) => rule.ruleId));
  const standing = rulesBlockingGroup(group, rules, timezone, now)
    .filter((rule) => !liftIds.has(rule.ruleId))
    .flatMap(({ ruleId }) => rules.filter((rule) => rule.id === ruleId));
  const names = [...new Set(standing.map((rule) => rule.name))];
  const one = names.length === 1;
  const its = names.length
    ? ` Its ${listNames(names.map((name) => `“${name}”`))} ${one ? "rule is" : "rules are"} always on`
    : "";
  const kept = names.length
    ? `${its}, so ${one ? "it stays" : "they stay"} on.`
    : "";
  const { active, until: pauseEnd } = group.suspension;
  const paused =
    active && (pauseEnd === null || Date.parse(pauseEnd) > now.getTime());
  if (!paused && lifts.length === 0) {
    const change = names.length ? " You can change that in FamilyFi." : "";
    const say = `${group.name} isn't blocked, so there's nothing to unblock.${kept}${change}`;
    if (!standing.length) return { send: false, say };
    // Siri can ask instead: lift one always-on rule for the group a while, as the card's "Unblock <rule>" does.
    const choices = standing.map((rule) => ({
      ruleId: rule.id,
      name: rule.name,
    }));
    const question =
      choices.length === 1
        ? `${group.name} isn't blocked.${its}. Should I unblock it for a while?`
        : `${group.name} isn't blocked.${its}. Which one should I unblock for a while?`;
    const declined = `OK, ${listNames(names.map((name) => `“${name}”`))} ${one ? "stays" : "stay"} on for ${group.name}.`;
    return {
      send: false,
      say,
      offer: { question, choices, howLong: "For how long?", declined },
    };
  }
  // Each lifted rule comes back when its window ends; the group is online until the last of them.
  const open = lifts.some((rule) => rule.until === null);
  const last =
    open || lifts.length === 0
      ? null
      : new Date(Math.max(...lifts.map((rule) => Date.parse(rule.until!))));
  const until = last ? ` until ${formatClock(last, timezone)}` : "";
  return { send: true, say: `${group.name} is unblocked${until}.${kept}` };
}

/**
 * Unblock's answer. `offer`, when only always-on rules block the group, is the follow-up Siri asks
 * instead of stopping there: which rule to lift for the group (one: whether to), then for how long.
 * `declined` is the answer when the offer isn't taken (a no, or nobody to ask); `say` is for a client that
 * can't make the offer.
 * The rule is then paused for the group alone until that time (`/groups/{id}/rules/{ruleId}/pause`).
 */
export type UnblockAnswer = {
  send: boolean;
  say: string;
  offer?: {
    question: string;
    choices: UnblockChoice[];
    howLong: string;
    declined: string;
  };
};

/** An always-on rule Siri offers to lift, by its own name. */
export type UnblockChoice = { ruleId: string; name: string };

/** What Siri says once it lifted one always-on rule for the group: "“No streaming” is unblocked for TV until 3:15 PM." */
export function ruleUnblockAnswer(
  group: Pick<Group, "name">,
  choice: UnblockChoice,
  until: Date,
  timezone: string,
): string {
  return `“${choice.name}” is unblocked for ${group.name} until ${formatClock(until, timezone)}.`;
}

/**
 * What Resume outside the app does, and what it answers: it puts back what someone lifted, as the
 * card's Resume button and its "Block <rule> again" items do. For a group alone it ends the group's
 * unblock (`/unblock/end`) and puts back each rule paused for that group. For a group and a rule it
 * puts back that rule for that group alone: a pause is resumed, an unblock's allowance on it is ended
 * (`disallow`); a rule paused for everyone stays so, and the answer says how to resume it. For a rule
 * alone it is put back for everyone and for each group it was lifted for. A group's own block is not
 * a lift; built-in and switched-off rules are never touched, and the answer says why. `writes` are the API
 * paths to POST, with empty bodies, in order; none when nothing is lifted, and the answer says so.
 * The answer names the rules that block the group again now: an internet rule by its window.
 */
export function resumeAnswer(
  target: { group?: Group; ruleId?: string },
  rules: Rule[],
  timezone: string,
  now: Date,
): ResumeAnswer {
  const { group } = target;
  const rule =
    target.ruleId === undefined
      ? undefined
      : rules.find((item) => item.id === target.ruleId);
  const quoted = (item: Pick<Rule, "name">) => `“${item.name}”`;
  if (target.ruleId !== undefined && !rule)
    return { writes: [], say: "That rule is no longer in FamilyFi." };
  if (rule?.builtIn)
    return { writes: [], say: `${quoted(rule)} can't be resumed from Siri. Open FamilyFi instead.` };
  if (rule && !rule.enabled)
    return { writes: [], say: `${quoted(rule)} is turned off. You can turn it on in FamilyFi.` };
  if (
    group &&
    rule &&
    !groupScopedRules(rules, group.id).some((item) => item.id === rule.id)
  ) {
    return {
      writes: [],
      say: `${quoted(rule)} doesn't apply to ${group.name}.`,
    };
  }

  // Each lift to put back, and the write that does it.
  const writes: string[] = [];
  const restored = new Set<string>();
  const groupPath = (groupId: string, ruleId: string, verb: string) =>
    `/api/v1/groups/${groupId}/rules/${ruleId}/${verb}`;
  const everyone = (item: Rule) => {
    if (!rulePaused(item, now)) return;
    writes.push(
      `/api/v1/rules/${item.id}/${item.pause.kind === "allow" ? "disallow" : "resume"}`,
    );
    restored.add(item.id);
  };
  const forGroup = (item: Rule, groupId: string) => {
    const lift = groupLift(item, groupId, now);
    if (!lift) return;
    writes.push(
      groupPath(
        groupId,
        item.id,
        lift.kind === "allow" ? "disallow" : "resume",
      ),
    );
    restored.add(item.id);
  };

  if (group && !rule) {
    const scoped = groupScopedRules(rules, group.id).filter(
      (item) => !item.builtIn && item.enabled,
    );
    // The group's unblock is one write that ends every allowance it made; pauses go one by one.
    if (
      scoped.some((item) => groupLift(item, group.id, now)?.kind === "allow")
    ) {
      writes.push(`/api/v1/groups/${group.id}/unblock/end`);
      for (const item of scoped)
        if (groupLift(item, group.id, now)?.kind === "allow")
          restored.add(item.id);
    }
    for (const item of scoped)
      if (groupLift(item, group.id, now)?.kind === "pause")
        forGroup(item, group.id);
    if (!writes.length)
      return {
        writes,
        say: `Nothing is unblocked for ${group.name}, so there's nothing to resume.`,
      };
  } else if (group && rule) {
    // Only this group, as the card's "Block <rule> again": a pause for everyone stays for the rule's Resume.
    forGroup(rule, group.id);
    if (!writes.length)
      return {
        writes,
        say: rulePaused(rule, now)
          ? `${quoted(rule)} is paused for everyone, not just ${group.name}. To put it back for everyone, say “Resume blocking ${rule.name}”.`
          : `${quoted(rule)} isn't unblocked for ${group.name}, so there's nothing to resume.`,
      };
  } else if (rule) {
    everyone(rule);
    for (const item of rule.groupPauses ?? []) forGroup(rule, item.groupId);
    if (!writes.length)
      return {
        writes,
        say: `${quoted(rule)} isn't paused or unblocked, so there's nothing to resume.`,
      };
    return { writes, say: `${quoted(rule)} applies again.` };
  } else {
    return { writes, say: "Which group or rule should I resume?" };
  }

  // What blocks the group once its lifts are gone: the restored rules that are in force now.
  const after = rules.map((item) =>
    restored.has(item.id)
      ? {
          ...item,
          groupPauses: (item.groupPauses ?? []).filter(
            (lift) => lift.groupId !== group.id,
          ),
        }
      : item,
  );
  // An internet rule goes by its window, as the card's "Block Dinner again" does; others by their own names.
  const names = [
    ...new Set(
      rulesBlockingGroup(group, after, timezone, now)
        .filter((item) => restored.has(item.ruleId))
        .map((item) =>
          item.kind === "internet"
            ? item.name
            : (after.find((each) => each.id === item.ruleId)?.name ??
              item.name),
        ),
    ),
  ];
  if (names.length) {
    return {
      writes,
      say: `${listNames(names.map((name) => `“${name}”`))} ${names.length === 1 ? "is" : "are"} blocking ${group.name} again.`,
    };
  }
  // A rule paused for everyone stays paused: Resume put back only the group's own lift on it.
  const still = [
    ...new Set(
      after
        .filter((item) => restored.has(item.id) && rulePaused(item, now))
        .map((item) => item.name),
    ),
  ];
  if (still.length) {
    return {
      writes,
      say: `Resumed for ${group.name}, but ${listNames(still.map((name) => `“${name}”`))} ${still.length === 1 ? "is" : "are"} still paused for everyone.`,
    };
  }
  return {
    writes,
    say: rule
      ? `${quoted(rule)} applies to ${group.name} again.`
      : `${possessive(group.name)} rules apply again.`,
  };
}

/** Resume's writes (API paths, POSTed with empty bodies, in order) and what it answers. */
export type ResumeAnswer = { writes: string[]; say: string };

/** "Cassie's", and "Kids'" for a name ending in s, as it is said. */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** "Video", "Video and Gaming", "Video, Gaming and Social". */
function listNames(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1
    ? (unique[0] ?? "")
    : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** A Quick Settings tile's own words: its names in Android's tile editor, and the line under a tile. */
export function quickSettingsTileCopy() {
  return {
    /** Each tile's name before the app gives it its group's name, in order. */
    names: Array.from({ length: QUICK_SETTINGS_TILES }, (_, index) =>
      index === 0 ? "FamilyFi Block" : `FamilyFi Block ${index + 1}`,
    ),
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
  needsUpdate:
    "To use Quick Settings tiles, update your FamilyFi server from Settings on your computer.",
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
