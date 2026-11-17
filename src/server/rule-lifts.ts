import { RuleLiftKind } from "@prisma/client";
import { z } from "zod";
import { mapLimited } from "@/lib/concurrency";
import { QUARANTINE_RULE_ID, type BuiltInRule } from "@/lib/rules";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { deviceScopeRefusal } from "./auth";
import { prisma } from "./db";
import { demoLocked } from "./demo";
import { sessionActor } from "./groups";
import { readJson } from "./guard";
import { loadHousehold } from "./household";
import { ApiError, jsonError, ResponseRefusal } from "./http";
import {
  activeWindowsEnd,
  builtInRule,
  householdNetworkScope,
  isQuarantineRule,
  presentRule,
  refusingRuleInput,
  ruleInclude,
  ruleInternetWindows,
  ruleNotFound,
  type RuleUpdateBody,
  saveBuiltInRule,
  saveRule,
  setQuarantineEnforced,
  validateRule,
} from "./rules";
import { clientForHousehold, connectionIdentity } from "./unifi/connection";
import { GATEWAY_CONCURRENCY } from "./unifi/networks";

export type LiftAction = "pause" | "resume" | "extend" | "allow" | "disallow";

/** What a verb's request may carry: `minutes` for extend, an optional `until` for pause and allow. */
export type LiftBody = { until?: string | null; minutes?: number };

const UntilBody = z.object({ until: z.string().datetime().nullable().optional() });
const ExtendBody = z.object({ minutes: z.number().int().positive() });

export const CLEARED = { pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null };

/**
 * One rule's pause or allowance, for everyone the rule covers (`groupId` absent) or for one
 * group alone. Both scopes speak the same five verbs with the same meaning: pause, resume
 * and extend act on a pause; allow and disallow on an allowance. Ending the other kind does
 * nothing, as a group's resume and allowance cancel do. `body` is what `readLiftBody` read.
 */
export async function liftRule(
  session: Parameters<typeof sessionActor>[0],
  action: LiftAction,
  target: { ruleId: string; groupId?: string },
  body: LiftBody,
) {
  const rule = await prisma().rule.findUnique({ where: { id: target.ruleId }, include: ruleInclude });
  if (!rule || rule.systemGroupId) throw new ApiError(404, "not_found", "Rule not found.");
  const quarantine = isQuarantineRule(rule);
  // Quarantine blocks around the clock and covers no group: it is paused, never allowed.
  if (quarantine && (action === "allow" || action === "disallow")) throw builtInError();
  const link = target.groupId ? rule.groups.find((item) => item.groupId === target.groupId) : undefined;
  if (target.groupId && !link) throw new ApiError(404, "not_found", "That group does not have this rule.");
  const state = link ?? rule;
  const now = new Date();

  let data: Record<string, unknown> | null = null;
  if (action === "resume" || action === "disallow") {
    const kind = action === "resume" ? RuleLiftKind.pause : RuleLiftKind.allow;
    if (state.pauseActive && state.pauseKind === kind) data = CLEARED;
  } else {
    const enabled = quarantine ? (await loadHousehold()).quarantineEnforced : rule.enabled;
    if (!enabled) throw new ApiError(409, "rule_off", "This rule is off.");
    if (action === "extend") {
      if (!state.pauseActive || state.pauseKind !== RuleLiftKind.pause) throw new ApiError(409, "not_paused", "Extend requires an active pause.");
      if (!state.pauseUntil) throw new ApiError(409, "indefinite", "An indefinite pause has no expiry to extend.");
      data = { pauseUntil: extendSuspensionUntil(state.pauseUntil, now, body.minutes! * 60_000) };
    } else {
      const { until: requested } = body;
      let until: Date | null;
      if (action === "allow" && requested === undefined) {
        // Until the windows active now end; an always-on rule never does, so until disallowed.
        const ends = activeWindowsEnd(ruleInternetWindows(rule), now, (await loadHousehold()).timezone);
        if (ends === undefined) throw new ApiError(409, "not_in_window", "This rule is not blocking now.");
        until = ends;
      } else {
        until = requested ? new Date(requested) : null;
      }
      if (until && until.getTime() <= now.getTime()) throw new ApiError(400, "invalid_request", "until must be in the future.");
      const actor = sessionActor(session);
      data = {
        pauseActive: true,
        pauseUntil: until,
        pauseKind: action === "pause" ? RuleLiftKind.pause : RuleLiftKind.allow,
        pausedByAccountId: actor.accountId,
        pausedByName: actor.name,
      };
    }
  }

  if (data) {
    if (link) await prisma().ruleGroup.update({ where: { ruleId_groupId: { ruleId: rule.id, groupId: link.groupId } }, data });
    else await prisma().rule.update({ where: { id: rule.id }, data });
  }
  const fresh = await prisma().rule.findUniqueOrThrow({ where: { id: rule.id }, include: ruleInclude });
  const change = await enqueueChange(action === "disallow" ? "allow" : action);
  return { rule: await presentRule(fresh), change };
}

/** What editing or deleting a built-in rule answers, beyond what that rule lets change. */
function builtInError(which: BuiltInRule = "quarantine"): ApiError {
  return new ApiError(
    409,
    "rule_built_in",
    which === "dns"
      ? "Lock DNS is built in: it can be switched, paused and allowed, and what it applies to changed, but nothing else edited, and it cannot be deleted."
      : which === "countries"
        ? "Block countries is built in: its countries and what it applies to can change, and it can be switched, paused and allowed, but it can't be renamed, rescheduled or deleted."
        : "Quarantine is built in: it can be paused, extended and resumed, but not edited, deleted or allowed.",
  );
}

/**
 * Switches the built-in quarantine rule, which is the household's quarantine setting: the same
 * write as `PUT /settings/household` with `quarantineEnforced`, so demo mode refuses it too.
 * The guard checked the device's scope against the path as sent, where the id may be
 * percent-encoded; the scope is checked again here against the rule it names. `method` is the
 * request's: POST from the on and off verbs, PATCH from an update.
 */
async function switchQuarantineRule(
  session: Parameters<typeof sessionActor>[0] & { device: { id: string; clientType: string; scope: string } | null },
  enabled: boolean,
  method: "POST" | "PATCH",
) {
  if (session.device) {
    const verb = method === "POST" ? `/${enabled ? "on" : "off"}` : "";
    const refused = deviceScopeRefusal(session.device, method, `/api/v1/rules/${QUARANTINE_RULE_ID}${verb}`);
    if (refused) throw new ResponseRefusal(refused);
  }
  const locked = demoLocked();
  if (locked) throw new ResponseRefusal(locked);
  await setQuarantineEnforced(enabled);
  const change = await enqueueChange("quarantine");
  const rule = await prisma().rule.findUniqueOrThrow({ where: { id: QUARANTINE_RULE_ID }, include: ruleInclude });
  return { rule: await presentRule(rule), change };
}

/** The request body a verb takes: `minutes` for extend, an optional `until` for pause and allow. */
export async function readLiftBody(
  request: Request,
  action: LiftAction,
): Promise<{ ok: true; body: LiftBody } | { ok: false; response: Response }> {
  if (action === "extend") {
    const read = await readJson(request);
    if (!read.ok) return read;
    const parsed = ExtendBody.safeParse(read.value);
    if (!parsed.success) return { ok: false, response: jsonError(400, "invalid_request", "minutes must be a positive integer.") };
    return { ok: true, body: parsed.data };
  }
  if (action === "pause" || action === "allow") {
    let value: unknown = {};
    try {
      value = await request.json();
    } catch {
      value = {};
    }
    const parsed = UntilBody.safeParse(value);
    if (!parsed.success) return { ok: false, response: jsonError(400, "invalid_request", `Invalid ${action} request.`) };
    return { ok: true, body: parsed.data };
  }
  return { ok: true, body: {} };
}

type SwitchSession = Parameters<typeof switchQuarantineRule>[0];

/** Turns a rule on or off. Off leaves its policies in place, disabled, and ends any pause on it; a group's pause is untouched. */
export async function switchRule(session: SwitchSession, id: string, enabled: boolean) {
  const existing = await prisma().rule.findUnique({ where: { id } });
  if (!existing || existing.systemGroupId) throw ruleNotFound();
  if (isQuarantineRule(existing)) return switchQuarantineRule(session, enabled, "POST");
  let rule;
  if (enabled) {
    // Lock DNS switched on with nothing picked covers every person, Block countries every group.
    const builtIn = builtInRule(existing);
    rule =
      builtIn === "dns" || builtIn === "countries"
        ? await saveBuiltInRule(builtIn, { enabled: true })
        : await prisma().rule.update({ where: { id }, data: { enabled: true }, include: ruleInclude });
  } else {
    rule = await prisma().rule.update({ where: { id }, data: { enabled: false, ...CLEARED }, include: ruleInclude });
  }
  const change = await enqueueChange("rule");
  return { rule: await presentRule(rule), change };
}

/**
 * Changes any field but the kind and scope. `windows` replaces the whole list: a window
 * sent with its `id` keeps its UniFi policy, one without an id is new, and a stored window
 * left out is removed with its policy.
 */
export async function updateRule(session: SwitchSession, id: string, patch: z.infer<typeof RuleUpdateBody>) {
  const existing = await prisma().rule.findUnique({ where: { id }, include: ruleInclude });
  if (!existing || existing.systemGroupId) throw ruleNotFound();
  const keys = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
  if (isQuarantineRule(existing)) {
    // Its switch is all that changes: anything else in the patch is an edit.
    if (keys.length !== 1 || patch.enabled === undefined) throw builtInError();
    return switchQuarantineRule(session, patch.enabled, "PATCH");
  }
  const builtIn = builtInRule(existing);
  if (builtIn === "dns" || builtIn === "countries") {
    // Its switch and what it applies to change, Block countries' countries and Lock DNS's Private Relay switch;
    // its name, kind and schedule are FamilyFi's.
    const allowed = ["enabled", "scope", "groupIds", "networkIds", ...(builtIn === "countries" ? ["countries"] : ["blockPrivateRelay"])];
    if (keys.length === 0 || keys.some((key) => !allowed.includes(key))) throw builtInError(builtIn);
    return refusingRuleInput(async () => {
      const rule = await saveBuiltInRule(builtIn, patch);
      const change = await enqueueChange("rule");
      return { rule: await presentRule(rule), change };
    });
  }
  if (patch.countries !== undefined) throw new ApiError(400, "invalid_request", "Only Block countries has countries.");
  if (patch.blockPrivateRelay !== undefined) throw new ApiError(400, "invalid_request", "Only Lock DNS turns off iCloud Private Relay.");
  if (patch.scope !== undefined && patch.scope !== existing.scope) {
    throw new ApiError(400, "invalid_request", "A rule's scope can't change. Make a new rule to cover something else.");
  }
  const current = await presentRule(existing);
  return refusingRuleInput(async () => {
    const input = await validateRule(
      {
        name: patch.name ?? current.name,
        kind: existing.kind,
        scope: existing.scope,
        groupIds: patch.groupIds ?? current.groupIds ?? [],
        networkIds: patch.networkIds ?? current.networkIds ?? [],
        targetIds: patch.targetIds ?? current.targetIds ?? [],
        domains: patch.domains ?? current.domains ?? [],
        enabled: patch.enabled ?? current.enabled,
        mode: patch.mode ?? current.mode,
        windows: (patch.windows ?? current.windows ?? []).map((window) => ({ ...window, name: window.name ?? "" })),
        useGeneratedName: patch.useGeneratedName ?? current.useGeneratedName,
      },
      // Unchanged networks were valid when saved; only a new list is checked against the site.
      patch.networkIds ? householdNetworkScope : async () => ({ scope: { manageAllNetworks: true, managedNetworkIds: [] } }),
    );
    const rule = await saveRule(input, id);
    const change = await enqueueChange("rule");
    return { rule: await presentRule(rule), change };
  });
}

/** Deletes a rule and its gateway policies, here rather than at the next sync pass. A built-in rule is never deleted. */
export async function deleteRule(id: string) {
  const existing = await prisma().rule.findUnique({
    where: { id },
    include: { policies: true },
  });
  if (!existing || existing.systemGroupId) throw ruleNotFound();
  const builtIn = builtInRule(existing);
  if (builtIn) throw builtInError(builtIn);
  // Delete recorded UniFi policies only (D3). Never touch a group's pause AppPolicy rows.
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (household && household.connectionStatus !== "unconfigured" && household.unifiSiteId) {
    try {
      const client = clientForHousehold(household);
      const identity = connectionIdentity(household);
      const siteId = household.unifiSiteId;
      const ids = existing.policies
        .filter((policy) => policy.connectionIdentity === identity && policy.siteId === siteId && policy.unifiPolicyId)
        .map((policy) => policy.unifiPolicyId!);
      // A few at a time, so a rule of many windows does not hold the request for each in turn.
      await mapLimited(ids, GATEWAY_CONCURRENCY, async (unifiPolicyId) => {
        try {
          await client.deletePolicy(siteId, unifiPolicyId);
        } catch {
          // Its applied creation record outlives the rule, so the next pass's orphan sweep deletes it.
        }
      });
    } catch {
      // Desired-state delete still proceeds; Sync will surface connection errors.
    }
  }
  // A group whose Block button stood for it goes back to all internet.
  await prisma().$transaction([
    prisma().rulePolicy.deleteMany({ where: { ruleId: id } }),
    prisma().rule.delete({ where: { id } }),
    prisma().group.updateMany({ where: { blockButtonRuleId: id }, data: { blockButtonRuleId: null } }),
  ]);
  return { change: await enqueueChange("rule") };
}
