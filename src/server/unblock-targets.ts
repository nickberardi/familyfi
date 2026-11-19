import { RuleLiftKind } from "@prisma/client";
import { standingRule } from "@/lib/group-actions";
import { COUNTRIES_RULE_ID } from "@/lib/rules";
import { blockButtonRuleOf, blockRuleOf, type GroupWithRules, lifted } from "./groups";
import { activeWindowsEnd, isLockDnsRule, ruleInternetWindows } from "./rules";

/**
 * What a group's Unblock lifts now: its pause (`blockedByPause`, with the block rule's end), and
 * each of its rules that may be lifted (`candidates`), with when its active windows end (`ends`:
 * undefined while it is not blocking, null when it has no end). Lock DNS and Block countries are
 * never a block on the group, and an always-on category, app or website rule is how the group is
 * set up, so it stays on, unless it is the group's Block button rule (`buttonRuleId`), which its
 * Unblock is for. A child's ask to unblock is the same Unblock (`fileAsk`).
 */
export function unblockTargets(group: GroupWithRules, now: Date, timezone: string) {
  const block = blockRuleOf(group);
  const blockedByPause = Boolean(block?.enabled && (block.expiresAt === null || now < block.expiresAt));
  const links = group.rules.filter(({ rule }) => rule.systemGroupId === null && !isLockDnsRule(rule) && rule.id !== COUNTRIES_RULE_ID);
  const buttonRuleId = blockButtonRuleOf(group)?.id;
  // A rule paused for everyone, or paused for this group, is not blocking it. One this group is
  // already allowed is included, so an unblock can be given a new time.
  const candidates = links.filter(
    ({ rule, ...link }) =>
      rule.enabled && (!standingRule(rule) || rule.id === buttonRuleId) && !lifted(rule, now) && !(lifted(link, now) && link.pauseKind !== RuleLiftKind.allow),
  );
  const ends = new Map(candidates.map(({ rule }) => [rule.id, activeWindowsEnd(ruleInternetWindows(rule), now, timezone)] as const));
  return { links, block, blockedByPause, buttonRuleId, candidates, ends };
}
