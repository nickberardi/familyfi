import { type DeviceScope, type PairedDeviceClient, RuleLiftKind } from "@prisma/client";
import { z } from "zod";
import { QUARANTINE_RULE_ID } from "@/lib/rules";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "./changes";
import { deviceScopeRefusal } from "./auth";
import { prisma } from "./db";
import { demoLocked } from "./demo";
import { sessionActor } from "./groups";
import { readJson } from "./guard";
import { jsonError } from "./http";
import {
  activeWindowsEnd,
  isQuarantineRule,
  presentRule,
  ruleInclude,
  ruleInternetWindows,
  setQuarantineEnforced,
} from "./rules";

export type LiftAction = "pause" | "resume" | "extend" | "allow" | "disallow";

const UntilBody = z.object({ until: z.string().datetime().nullable().optional() });
const ExtendBody = z.object({ minutes: z.number().int().positive() });

export const CLEARED = { pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null };

/**
 * One rule's pause or allowance, for everyone the rule covers (`groupId` absent) or for one
 * group alone. Both scopes speak the same five verbs with the same meaning: pause, resume
 * and extend act on a pause; allow and disallow on an allowance. Ending the other kind does
 * nothing, as a group's resume and allowance cancel do. Returns `{ rule, change }`.
 */
export async function runLift(
  request: Request,
  session: Parameters<typeof sessionActor>[0],
  action: LiftAction,
  target: { ruleId: string; groupId?: string },
): Promise<Response> {
  const read = await readLiftBody(request, action);
  if (!read.ok) return read.response;
  const body = read.body;

  const rule = await prisma().rule.findUnique({ where: { id: target.ruleId }, include: ruleInclude });
  if (!rule || rule.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
  const quarantine = isQuarantineRule(rule);
  // Quarantine blocks around the clock and covers no group: it is paused, never allowed.
  if (quarantine && (action === "allow" || action === "disallow")) return builtInRefusal();
  const link = target.groupId ? rule.groups.find((item) => item.groupId === target.groupId) : undefined;
  if (target.groupId && !link) return jsonError(404, "not_found", "That group does not have this rule.");
  const state = link ?? rule;
  const now = new Date();

  let data: Record<string, unknown> | null = null;
  if (action === "resume" || action === "disallow") {
    const kind = action === "resume" ? RuleLiftKind.pause : RuleLiftKind.allow;
    if (state.pauseActive && state.pauseKind === kind) data = CLEARED;
  } else {
    const enabled = quarantine ? (await household()).quarantineEnforced : rule.enabled;
    if (!enabled) return jsonError(409, "rule_off", "This rule is off.");
    if (action === "extend") {
      if (!state.pauseActive || state.pauseKind !== RuleLiftKind.pause) return jsonError(409, "not_paused", "Extend requires an active pause.");
      if (!state.pauseUntil) return jsonError(409, "indefinite", "An indefinite pause has no expiry to extend.");
      data = { pauseUntil: extendSuspensionUntil(state.pauseUntil, now, (body as z.infer<typeof ExtendBody>).minutes * 60_000) };
    } else {
      const { until: requested } = body as z.infer<typeof UntilBody>;
      let until: Date | null;
      if (action === "allow" && requested === undefined) {
        // Until the windows active now end; an always-on rule never does, so until disallowed.
        const ends = activeWindowsEnd(ruleInternetWindows(rule), now, (await household()).timezone);
        if (ends === undefined) return jsonError(409, "not_in_window", "This rule is not blocking now.");
        until = ends;
      } else {
        until = requested ? new Date(requested) : null;
      }
      if (until && until.getTime() <= now.getTime()) return jsonError(400, "invalid_request", "until must be in the future.");
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
  return Response.json({ rule: await presentRule(fresh), change });
}

/** What editing or deleting the built-in quarantine rule answers. */
export function builtInRefusal(): Response {
  return jsonError(409, "rule_built_in", "Quarantine is built in: it can be switched on or off, paused and resumed, not edited.");
}

/**
 * Switches the built-in quarantine rule, which is the household's quarantine setting: the same
 * write as `PUT /settings/household` with `quarantineEnforced`, so demo mode refuses it too.
 * The guard checked the device's scope against the path as sent, where the id may be
 * percent-encoded; the scope is checked again here against the rule it names.
 */
export async function switchQuarantineRule(
  request: Request,
  session: Parameters<typeof sessionActor>[0] & { device: { id: string; client: PairedDeviceClient; scope: DeviceScope } | null },
  enabled: boolean,
): Promise<Response> {
  if (session.device) {
    const verb = request.method === "POST" ? `/${enabled ? "on" : "off"}` : "";
    const refused = deviceScopeRefusal(session.device, request.method, `/api/v1/rules/${QUARANTINE_RULE_ID}${verb}`);
    if (refused) return refused;
  }
  const locked = demoLocked();
  if (locked) return locked;
  await setQuarantineEnforced(enabled);
  const change = await enqueueChange("quarantine");
  const rule = await prisma().rule.findUniqueOrThrow({ where: { id: QUARANTINE_RULE_ID }, include: ruleInclude });
  return Response.json({ rule: await presentRule(rule), change });
}

async function household() {
  return prisma().household.findUniqueOrThrow({ where: { id: "default" } });
}

/** The request body a verb takes: `minutes` for extend, an optional `until` for pause and allow. */
export async function readLiftBody(
  request: Request,
  action: LiftAction,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
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
