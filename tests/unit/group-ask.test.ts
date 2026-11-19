import { describe, expect, it } from "vitest";

import { askSheetChoices, askSheetCustom, groupAskLine } from "@/lib/group-ask";
import { answerAsk, runGroupCardAction } from "@/lib/group-writes";
import type { HouseholdLists } from "@/lib/household-state";
import type { HouseholdStore, MutateOptions } from "@/lib/household-store";
import type { Rule } from "@/lib/rules";
import { askWaitChoices, askWaitLabel } from "@/lib/settings-copy";
import { setAskWait } from "@/lib/settings-writes";
import type { Group, GroupAsk } from "@/lib/types";
import { groupCardControls } from "@/ui/group-card-controls";

const TZ = "America/New_York";
// Monday 16 November 2026, 10:30 PM in New York.
const NOW = new Date("2026-11-17T03:30:00Z");

const bedtime = {
  id: "r1",
  name: "Bedtime",
  kind: "internet",
  scope: "group",
  groupIds: ["g1"],
  networkIds: [],
  targetIds: [],
  domains: [],
  enabled: true,
  pause: { active: false, until: null, kind: "pause", by: null },
  groupPauses: [],
  mode: "scheduled",
  windows: [{ name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "21:00", end: "07:00" }],
  useGeneratedName: false,
  policyNames: [],
} as unknown as Rule;

const ruleAsk: GroupAsk = { id: "a1", about: "rule", ruleId: "r1", minutes: 30, state: "waiting", at: "2026-11-17T03:25:00Z", expiresAt: "2026-11-17T04:25:00Z" };
const pauseAsk: GroupAsk = { id: "a2", about: "pause", state: "waiting", at: "2026-11-17T03:25:00Z", expiresAt: "2026-11-17T04:25:00Z" };

function emma(ask: GroupAsk | undefined): Group {
  return {
    id: "g1",
    kind: "family",
    name: "Emma",
    familyRole: "child",
    deviceCount: 1,
    suspension: { active: false, until: null, by: null },
    allowance: { active: false, until: null, by: null },
    ...(ask ? { ask } : {}),
  } as unknown as Group;
}

/** A store's mutate that records what each write sends, and what it shows before the answer comes back. */
function recorder(lists: HouseholdLists) {
  const sent: { path: string; init?: { method?: string; body?: unknown }; options: MutateOptions }[] = [];
  let shown = lists;
  const mutate = (async (run: (send: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>) => Promise<unknown>, options: MutateOptions = {}) => {
    if (options.optimistic) shown = options.optimistic(shown);
    await run(async (path, init) => {
      sent.push({ path, init, options });
      return {};
    });
    return {};
  }) as unknown as HouseholdStore["mutate"];
  return { sent, mutate, shown: () => shown };
}

describe("a child's ask, as a parent answers it", () => {
  it("shows the line while the ask waits, and opens the answer sheet from it", () => {
    const opened: unknown[] = [];
    const controls = groupCardControls(emma(ruleAsk), [bedtime], TZ, NOW, (tap) => runGroupCardAction((async () => undefined) as never, emma(ruleAsk), tap, (target) => opened.push(target)));
    expect(controls.ask).toMatchObject({ label: "Asked for 30 minutes off Bedtime", testID: "group-ask-g1" });
    controls.ask!.onPress();
    expect(opened).toEqual([{ kind: "ask" }]);
    expect(groupCardControls(emma(undefined), [bedtime], TZ, NOW, () => undefined).ask).toBeNull();
    expect(groupAskLine(emma({ ...ruleAsk, state: "no" }), [bedtime], NOW)).toBeNull();
  });

  it("says yes as asked with the rule's allow and the ask's id, and takes the line away at once", async () => {
    const { sent, mutate, shown } = recorder({ groups: [emma(ruleAsk)], devices: [] });
    const [asked] = askSheetChoices(ruleAsk, [bedtime], TZ, NOW, 30);
    await answerAsk(mutate, emma(ruleAsk), ruleAsk, asked as never, "Bedtime", NOW);
    expect(sent[0]).toMatchObject({ path: "/api/v1/groups/g1/rules/r1/allow", init: { method: "POST", body: { askId: "a1" } } });
    expect(sent[0]!.options.feedback?.notice).toBe("Bedtime is off for Emma until 11:00 PM.");
    expect(shown().groups[0]!.ask?.state).toBe("yes");
    expect(groupAskLine(shown().groups[0]!, [bedtime], NOW)).toBeNull();
  });

  it("says yes for a time of the parent's own, as a time on the allow", async () => {
    const { sent, mutate } = recorder({ groups: [emma(ruleAsk)], devices: [] });
    const option = askSheetCustom({ kind: "for", minutes: 15 }, ruleAsk, [bedtime], TZ, NOW)!;
    await answerAsk(mutate, emma(ruleAsk), ruleAsk, option, "Bedtime", NOW);
    expect(sent[0]!.init).toEqual({ method: "POST", body: { askId: "a1", until: "2026-11-17T03:45:00.000Z" } });
    const ends = askSheetChoices(ruleAsk, [bedtime], TZ, NOW, 30).find((choice) => choice.label === "Until Bedtime ends")!;
    await answerAsk(mutate, emma(ruleAsk), ruleAsk, ends as never, "Bedtime", NOW);
    expect(sent[1]!.init).toEqual({ method: "POST", body: { askId: "a1", until: "2026-11-17T12:00:00.000Z" } });
  });

  it("unblocks with the group's own unblock and the ask's id, as its card's Unblock does", async () => {
    const { sent, mutate } = recorder({ groups: [emma(pauseAsk)], devices: [] });
    const [unblock] = askSheetChoices(pauseAsk, [], TZ, NOW, 30, emma(pauseAsk));
    expect(unblock).toMatchObject({ label: "Unblock" });
    await answerAsk(mutate, emma(pauseAsk), pauseAsk, unblock as never, undefined, NOW);
    expect(sent[0]).toMatchObject({ path: "/api/v1/groups/g1/unblock", init: { method: "POST", body: { askId: "a2" } } });
    expect(sent[0]!.options.feedback?.notice).toBe("Emma unblocked.");
  });

  it("says Not now with the ask's decline", async () => {
    const { sent, mutate, shown } = recorder({ groups: [emma(pauseAsk)], devices: [] });
    const notNow = askSheetChoices(pauseAsk, [], TZ, NOW, 30).at(-1)!;
    expect(notNow.label).toBe("Not now");
    await answerAsk(mutate, emma(pauseAsk), pauseAsk, notNow as never, undefined, NOW);
    expect(sent[0]).toMatchObject({ path: "/api/v1/groups/g1/asks/a2/decline", init: { method: "POST" } });
    expect(shown().groups[0]!.ask?.state).toBe("no");
  });
});

describe("Settings' waits for asks", () => {
  it("lists each wait, with one set elsewhere among them", () => {
    expect(askWaitChoices("wait", 30).map((choice) => choice.label)).toEqual(["Right away", "After 15 minutes", "After 30 minutes", "After an hour", "After 2 hours"]);
    expect(askWaitChoices("timeout", 45).map((choice) => choice.value)).toEqual([5, 15, 30, 45, 60, 120, 240, 1440]);
    expect(askWaitLabel(1440, "timeout")).toBe("For a day");
    expect(askWaitLabel(90, "timeout")).toBe("For 1 hour 30 minutes");
  });

  it("saves each wait on the household's settings", async () => {
    const { sent, mutate } = recorder({ groups: [], devices: [] });
    await setAskWait(mutate, { askTimeoutMinutes: 120 });
    await setAskWait(mutate, { askWaitMinutes: 0 });
    expect(sent.map((item) => item.init)).toEqual([
      { method: "PUT", body: { askTimeoutMinutes: 120 } },
      { method: "PUT", body: { askWaitMinutes: 0 } },
    ]);
  });
});
