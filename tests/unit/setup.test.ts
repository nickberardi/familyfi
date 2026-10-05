import { describe, expect, it } from "vitest";
import type { ApiRequest } from "@/lib/api-client";
import {
  SCHEDULE_SUGGESTIONS,
  initialNetworkSelection,
  networkSelectionBody,
  saveMembers,
  saveSchedules,
  setupCta,
  setupRedirect,
  setupStepError,
  suggestionApplies,
  suggestionAppliesTo,
  suggestionRules,
  suggestionTimes,
  type SetupMember,
} from "@/lib/setup";

const suggestion = (id: string) => {
  const found = SCHEDULE_SUGGESTIONS.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
};

const household: SetupMember[] = [
  { id: "g-nick", name: "Nick", role: "adult" },
  { id: "g-ava", name: "Ava", role: "teen" },
  { id: "g-leo", name: "Leo", role: "child" },
  { id: "g-mia", name: "Mia", role: "child" },
];

const networks = [
  { id: "n1", name: "Default", vlanId: 1, zoneId: null },
  { id: "n2", name: "Kids", vlanId: 20, zoneId: null },
];

const fields = {
  wrote: true,
  connected: true,
  savedKey: false,
  host: "192.168.1.1",
  apiKey: "",
  selectedNetworks: ["n1"],
  members: household,
};

describe("setup steps", () => {
  it("holds each step until its answer is in", () => {
    expect(setupStepError(0, { ...fields, wrote: false })).toMatch(/admin password/);
    expect(setupStepError(1, { ...fields, connected: false, host: " " })).toMatch(/IP address or hostname/);
    expect(setupStepError(1, { ...fields, connected: false, apiKey: "" })).toMatch(/API key/);
    // A saved key is tested as it is, with no new one pasted (a cloud console has no host).
    expect(setupStepError(1, { ...fields, connected: false, savedKey: true, host: "", apiKey: "" })).toBeNull();
    expect(setupStepError(2, { ...fields, selectedNetworks: [] })).toBe("Pick at least one network.");
    expect(setupStepError(3, { ...fields, members: household.filter((member) => member.role !== "adult") })).toBe("Add at least one adult.");
    for (const step of [0, 1, 2, 3, 4]) expect(setupStepError(step, fields)).toBeNull();
  });

  it("tests the gateway before it moves on, and names the last steps", () => {
    expect(setupCta(1, false)).toBe("Test connection");
    expect(setupCta(1, true)).toBe("Continue");
    expect(setupCta(4, true)).toBe("Finish setup");
    expect(setupCta(5, true)).toBe("Open FamilyFi");
  });
});

describe("network selection", () => {
  it("starts from every network on a new connection, or what is saved", () => {
    expect(initialNetworkSelection(null, networks)).toEqual(["n1", "n2"]);
    expect(initialNetworkSelection({ configured: true, manageAllNetworks: false, managedNetworkIds: ["n2", "gone"] }, networks)).toEqual(["n2"]);
    expect(initialNetworkSelection({ configured: true, manageAllNetworks: true, managedNetworkIds: [] }, networks)).toEqual(["n1", "n2"]);
  });

  it("names networks one by one, unless the household already watched every network and still does", () => {
    expect(networkSelectionBody(null, networks, ["n1", "n2"])).toEqual({ manageAllNetworks: false, managedNetworkIds: ["n1", "n2"] });
    expect(networkSelectionBody({ configured: true, manageAllNetworks: true }, networks, ["n1", "n2"])).toEqual({ manageAllNetworks: true, managedNetworkIds: [] });
    expect(networkSelectionBody({ configured: true, manageAllNetworks: true }, networks, ["n2"])).toEqual({ manageAllNetworks: false, managedNetworkIds: ["n2"] });
  });
});

describe("suggested schedules", () => {
  it("makes one bedtime rule per role, each over that role's groups and overnight window", () => {
    expect(suggestionRules(suggestion("bedtime"), household)).toEqual([
      {
        name: "Children’s bedtime",
        kind: "internet",
        scope: "group",
        groupIds: ["g-leo", "g-mia"],
        targetIds: [],
        mode: "scheduled",
        windows: [{ name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "20:30", end: "07:00" }],
      },
      {
        name: "Teens’ bedtime",
        kind: "internet",
        scope: "group",
        groupIds: ["g-ava"],
        targetIds: [],
        mode: "scheduled",
        windows: [{ name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:30" }],
      },
    ]);
  });

  it("blocks games, video and social on school days for homework", () => {
    const [rule] = suggestionRules(suggestion("homework"), household);
    expect(rule).toMatchObject({ kind: "category", targetIds: [8, 4, 24], groupIds: ["g-ava", "g-leo", "g-mia"] });
    expect(rule.windows).toEqual([{ name: "", days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" }]);
  });

  it("leaves out a window nobody it names would be covered by", () => {
    const adultsAndTeen = household.filter((member) => member.role !== "child");
    expect(suggestionRules(suggestion("bedtime"), adultsAndTeen).map((rule) => rule.name)).toEqual(["Teens’ bedtime"]);
    expect(suggestionRules(suggestion("mornings"), adultsAndTeen)).toEqual([]);
    expect(suggestionApplies(suggestion("mornings"), adultsAndTeen)).toBe(false);
    expect(suggestionAppliesTo(suggestion("mornings"), adultsAndTeen)).toBe("No one this applies to yet");
  });

  it("covers only people whose group exists", () => {
    const unsaved: SetupMember[] = [{ name: "Leo", role: "child" }];
    expect(suggestionRules(suggestion("mornings"), unsaved)).toEqual([]);
  });

  it("says when and for whom in household time words", () => {
    expect(suggestionTimes(suggestion("bedtime"))).toBe("Every day · Children 8:30 PM–7 AM · Teens 10 PM–6:30 AM");
    expect(suggestionTimes(suggestion("homework"))).toBe("Mon–Fri · 4 PM–6 PM");
    expect(suggestionAppliesTo(suggestion("homework"), household)).toBe("For Ava, Leo, Mia");
  });
});

type Call = { path: string; method?: string; body?: unknown };

/** A fake API that records each call, answers with `answer`, and fails the call numbered `failAt`. */
function fakeApi(answer: (call: Call, index: number) => unknown, failAt?: number) {
  const calls: Call[] = [];
  const request = (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const call = { path, ...init };
    calls.push(call);
    if (calls.length - 1 === failAt) throw new Error("The server said no.");
    return answer(call, calls.length - 1);
  }) as ApiRequest;
  return { request, calls };
}

describe("saving the household", () => {
  it("adds new people, changes changed roles, and leaves the rest alone", async () => {
    const { request, calls } = fakeApi(() => ({ group: { id: "g-new" } }));
    const result = await saveMembers(request, [
      { id: "g-nick", name: "Nick", role: "adult", savedRole: "adult" },
      { id: "g-ava", name: "Ava", role: "child", savedRole: "teen" },
      { name: "Leo", role: "child" },
    ]);
    expect(calls).toEqual([
      { path: "/api/v1/groups/g-ava", method: "PUT", body: { familyRole: "child" } },
      { path: "/api/v1/groups", method: "POST", body: { kind: "family", name: "Leo", familyRole: "child" } },
    ]);
    expect(result).toEqual({
      error: null,
      members: [
        { id: "g-nick", name: "Nick", role: "adult", savedRole: "adult" },
        { id: "g-ava", name: "Ava", role: "child", savedRole: "child" },
        { id: "g-new", name: "Leo", role: "child", savedRole: "child" },
      ],
    });
  });

  it("keeps who was saved before a failure, so trying again adds nobody twice", async () => {
    const first = fakeApi((_, index) => ({ group: { id: `g-${index}` } }), 1);
    const people: SetupMember[] = [
      { name: "Leo", role: "child" },
      { name: "Mia", role: "child" },
    ];
    const failed = await saveMembers(first.request, people);
    expect(failed.error).toBe("The server said no.");
    expect(failed.members).toEqual([{ id: "g-0", name: "Leo", role: "child", savedRole: "child" }, { name: "Mia", role: "child" }]);

    const second = fakeApi(() => ({ group: { id: "g-mia" } }));
    const retried = await saveMembers(second.request, failed.members);
    expect(second.calls.map((call) => (call.body as { name: string }).name)).toEqual(["Mia"]);
    expect(retried.error).toBeNull();
  });
});

describe("saving schedules", () => {
  const bedtime = suggestion("bedtime");

  it("makes each rule once, even when the first try failed part-way", async () => {
    const first = fakeApi((_, index) => ({ rule: { id: `r-${index}` } }), 1);
    const failed = await saveSchedules(first.request, [bedtime], household, {});
    expect(failed.error).toBe("The server said no.");
    expect(Object.keys(failed.created)).toEqual(["Children’s bedtime"]);

    const second = fakeApi(() => ({ rule: { id: "r-teens" } }));
    const retried = await saveSchedules(second.request, [bedtime], household, failed.created);
    expect(second.calls.map((call) => (call.body as { name: string }).name)).toEqual(["Teens’ bedtime"]);
    expect(retried).toEqual({
      error: null,
      created: {
        "Children’s bedtime": { id: "r-0", groupIds: ["g-leo", "g-mia"] },
        "Teens’ bedtime": { id: "r-teens", groupIds: ["g-ava"] },
      },
    });
  });

  it("adds whoever joined before the retry to a rule it made, keeping who the rule already covers", async () => {
    const created = { "Children’s bedtime": { id: "r-kids", groupIds: ["g-tv", "g-leo"] }, "Teens’ bedtime": { id: "r-teens", groupIds: ["g-ava", "g-nick"] } };
    const { request, calls } = fakeApi(() => ({}));
    await saveSchedules(request, [bedtime], household, created);
    expect(calls).toEqual([{ path: "/api/v1/rules/r-kids", method: "PATCH", body: { groupIds: ["g-tv", "g-leo", "g-mia"] } }]);
  });
});

describe("opening setup", () => {
  it("is open before sign-in until the household has a gateway, then needs a signed-in admin", () => {
    expect(setupRedirect({ demo: false, configured: false, signedIn: false })).toBeNull();
    expect(setupRedirect({ demo: false, configured: false, signedIn: true })).toBeNull();
    expect(setupRedirect({ demo: false, configured: true, signedIn: false })).toBe("/login");
    expect(setupRedirect({ demo: false, configured: true, signedIn: true })).toBeNull();
  });

  it("never opens in the demo, whose gateway is locked", () => {
    expect(setupRedirect({ demo: true, configured: true, signedIn: false })).toBe("/family");
    expect(setupRedirect({ demo: true, configured: true, signedIn: true })).toBe("/family");
  });
});
