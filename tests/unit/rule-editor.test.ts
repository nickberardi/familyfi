import { describe, expect, it } from "vitest";
import type { HouseholdStore, MutateOptions } from "@/lib/household-store";
import {
  DEFAULT_WINDOW,
  NEW_WINDOW,
  addDomain,
  addWindow,
  blankDraft,
  canAddWindow,
  changeKind,
  changeMode,
  deleteRule,
  deleteRuleCopy,
  fromRule,
  liveDraft,
  managedNetworks,
  removeDomain,
  removeWindow,
  ruleEditorBack,
  ruleEditorParams,
  ruleEditorState,
  ruleSaveBody,
  saveRule,
  toggleRuleGroup,
  toggleRuleNetwork,
  toggleWindowDay,
  undoRemoveWindow,
  updateWindow,
  validateRuleDraft,
  windowTimeLabels,
  windowTitle,
  type EditorDraft,
} from "@/lib/rule-editor";
import { MAX_RULE_WINDOWS, type Rule } from "@/lib/rules";

const saved = (over: Partial<Rule> = {}) =>
  ({
    id: "r1",
    name: "School nights",
    useGeneratedName: false,
    kind: "internet",
    scope: "group",
    enabled: true,
    groupIds: ["g1"],
    networkIds: [],
    targetIds: [],
    domains: [],
    mode: "scheduled",
    windows: [{ id: "w1", name: "Bedtime", days: [0, 1, 2, 3, 4], start: "21:00", end: "07:00" }],
    policyNames: ["FamilyFi School nights"],
    ...over,
  }) as Rule;

const named = (draft: EditorDraft, over: Partial<EditorDraft> = {}): EditorDraft => ({ ...draft, name: "Bedtime", groupIds: ["g1"], ...over });

describe("starting a rule", () => {
  it("reads a link's query, ignoring an unknown kind or a target that is not a number", () => {
    expect(ruleEditorParams({})).toEqual({ kind: "internet" });
    expect(ruleEditorParams({ kind: ["domain", "app"], group: "g1", target: "7", name: "AI for A child", domains: "a.com,b.com" })).toEqual({
      kind: "domain",
      group: "g1",
      target: 7,
      name: "AI for A child",
      domains: "a.com,b.com",
    });
    expect(ruleEditorParams({ kind: "nonsense", target: "x" })).toEqual({ kind: "internet" });
  });

  it("starts all internet scheduled overnight, and anything narrower always on", () => {
    const internet = blankDraft({ kind: "internet", group: "g1" });
    expect(internet).toMatchObject({ mode: "scheduled", groupIds: ["g1"], scope: "group", enabled: true });
    expect(internet.windows).toHaveLength(1);
    expect(internet.windows[0]).toMatchObject(DEFAULT_WINDOW);
    expect(blankDraft({ kind: "app" })).toMatchObject({ mode: "always", windows: [], groupIds: [] });
  });

  it("fills a category's target and a Websites rule's domains, normalised and without repeats", () => {
    expect(blankDraft({ kind: "category", target: 7 }).targetIds).toEqual([7]);
    expect(blankDraft({ kind: "app", target: 7 }).targetIds).toEqual([]);
    expect(blankDraft({ kind: "domain", domains: "https://A.com/x,a.com,not a domain,b.org" }).domains).toEqual(["a.com", "b.org"]);
    expect(blankDraft({ kind: "domain", name: "x".repeat(80) }).name).toHaveLength(60);
  });

  it("copies a saved rule, so editing never changes it", () => {
    const rule = saved();
    const draft = toggleWindowDay(fromRule(rule), "w1", 5);
    expect(draft.windows[0]!.days).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rule.windows[0]!.days).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("editing a draft", () => {
  it("switches kind: all internet is for groups and scheduled, and starts a window when none is left", () => {
    const app = changeKind(blankDraft({ kind: "category", target: 7 }), "app");
    expect(app).toMatchObject({ kind: "app", targetIds: [], mode: "always" });
    const internet = changeKind({ ...app, scope: "network" }, "internet");
    expect(internet).toMatchObject({ scope: "group", mode: "scheduled" });
    expect(internet.windows).toHaveLength(1);
    expect(changeKind(internet, "internet").windows).toHaveLength(1);
  });

  it("starts a window when switching to scheduled with none left", () => {
    const always = blankDraft({ kind: "app" });
    expect(changeMode(always, "scheduled").windows).toHaveLength(1);
    const scheduled = changeMode(always, "scheduled");
    expect(changeMode(changeMode(scheduled, "always"), "scheduled").windows).toHaveLength(1);
  });

  it("keeps a removed saved window until it is saved, so it can come back, and drops an unsaved one", () => {
    const draft = addWindow(fromRule(saved()));
    const added = draft.windows[1]!;
    expect(added).toMatchObject(NEW_WINDOW);
    const removed = removeWindow(draft, "w1");
    expect(removed.windows[0]!.removed).toBe(true);
    expect(liveDraft(removed).windows.map((window) => window.start)).toEqual(["15:00"]);
    expect(undoRemoveWindow(removed, "w1").windows[0]!.removed).toBe(false);
    expect(removeWindow(draft, added.key).windows).toHaveLength(1);
    expect(removeWindow(draft, "missing")).toBe(draft);
  });

  it("edits a window's name, times and days, keeping days in order", () => {
    const draft = updateWindow(fromRule(saved()), "w1", { name: "Late", start: "22:00" });
    expect(draft.windows[0]).toMatchObject({ name: "Late", start: "22:00", end: "07:00" });
    expect(toggleWindowDay(draft, "w1", 2).windows[0]!.days).toEqual([0, 1, 3, 4]);
    expect(toggleWindowDay(toggleWindowDay(draft, "w1", 6), "w1", 5).windows[0]!.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(toggleWindowDay(draft, "missing", 2)).toBe(draft);
  });

  it("stops adding windows at the limit", () => {
    let draft = blankDraft({ kind: "internet" });
    while (canAddWindow(draft)) draft = addWindow(draft);
    expect(draft.windows).toHaveLength(MAX_RULE_WINDOWS);
    expect(addWindow(draft)).toBe(draft);
  });

  it("adds a website once, and says when a typed one is not a domain", () => {
    const draft = blankDraft({ kind: "domain" });
    const once = addDomain(draft, " Example.COM ").draft;
    expect(once.domains).toEqual(["example.com"]);
    expect(addDomain(once, "example.com").draft).toBe(once);
    expect(addDomain(once, " not a domain ")).toEqual({ draft: once, error: "“not a domain” is not a website domain." });
    expect(removeDomain(once, "example.com").domains).toEqual([]);
  });

  it("adds and drops groups and networks", () => {
    const draft = toggleRuleGroup(blankDraft({ kind: "app", group: "g1" }), "g2");
    expect(draft.groupIds).toEqual(["g1", "g2"]);
    expect(toggleRuleGroup(draft, "g1").groupIds).toEqual(["g2"]);
    expect(toggleRuleNetwork(toggleRuleNetwork(draft, "n1"), "n1").networkIds).toEqual([]);
  });
});

describe("checking a draft before it saves", () => {
  it("names the first problem", () => {
    const internet = blankDraft({ kind: "internet" });
    expect(validateRuleDraft(internet)).toBe("Give the rule a name.");
    expect(validateRuleDraft({ ...internet, name: "x" })).toBe("Pick at least one person or thing it applies to.");
    expect(validateRuleDraft({ ...internet, name: "x", scope: "network" })).toBe("Pick at least one network.");
    expect(validateRuleDraft(named(blankDraft({ kind: "domain" })))).toBe("Add at least one website.");
    expect(validateRuleDraft(named(blankDraft({ kind: "app" })))).toBe("Pick at least one app.");
    expect(validateRuleDraft(named(blankDraft({ kind: "category" })))).toBe("Pick at least one category.");
    const window = internet.windows[0]!;
    expect(validateRuleDraft(named(internet, { windows: [{ ...window, removed: true }] }))).toBe("Add at least one window.");
    expect(validateRuleDraft(named(internet, { windows: [{ ...window, days: [] }] }))).toBe("Each window needs at least one day.");
    expect(validateRuleDraft(named(internet, { windows: [{ ...window, end: window.start }] }))).toBe("A window cannot start and end at the same time.");
    expect(validateRuleDraft(named(internet))).toBeNull();
    expect(validateRuleDraft(named(blankDraft({ kind: "app" }), { targetIds: [3] }))).toBeNull();
  });
});

describe("saving a draft", () => {
  it("creates a rule with its kind and scope, sending only what that kind uses", () => {
    expect(ruleSaveBody(named(blankDraft({ kind: "app" }), { name: " Bedtime ", targetIds: [3] }), null)).toEqual({
      name: "Bedtime",
      useGeneratedName: false,
      groupIds: ["g1"],
      networkIds: undefined,
      targetIds: [3],
      domains: undefined,
      mode: "always",
      windows: [],
      kind: "app",
      scope: "group",
      enabled: true,
    });
  });

  it("patches a saved rule without its kind, and sends networks for a network rule", () => {
    const rule = saved({ kind: "domain", scope: "network", groupIds: [], networkIds: ["n1"], domains: ["a.com"], mode: "always", windows: [] });
    const body = ruleSaveBody(fromRule(rule), rule);
    expect(body).toEqual({
      name: "School nights",
      useGeneratedName: false,
      groupIds: undefined,
      networkIds: ["n1"],
      targetIds: undefined,
      domains: ["a.com"],
      mode: "always",
      windows: [],
    });
  });

  it("sends a scheduled rule's live windows without their editing keys", () => {
    const body = ruleSaveBody(addWindow(removeWindow(fromRule(saved()), "w1")), saved());
    expect(body.windows).toEqual([{ id: undefined, ...NEW_WINDOW }]);
  });

  it("posts a new rule and patches a saved one, saying which", async () => {
    const sent: { path: string; init?: { method?: string; body?: unknown } }[] = [];
    const notices: (string | undefined)[] = [];
    const mutate: HouseholdStore["mutate"] = async (run, options?: MutateOptions) => {
      notices.push(options?.feedback?.notice);
      return (await run(async (path, init) => {
        sent.push({ path, init });
        return { ok: true } as never;
      })) as never;
    };
    await saveRule(mutate, named(blankDraft({ kind: "internet" })), null);
    await saveRule(mutate, fromRule(saved()), saved());
    const removed = await deleteRule(mutate, saved());
    expect(sent.map((item) => `${item.init?.method} ${item.path}`)).toEqual(["POST /api/v1/rules", "PATCH /api/v1/rules/r1", "DELETE /api/v1/rules/r1"]);
    expect(notices).toEqual([
      "Bedtime created. FamilyFi writes it to the gateway next.",
      "School nights saved. FamilyFi writes it to the gateway next.",
      "School nights deleted. Its UniFi policies are removed on the next reconcile.",
    ]);
    expect(removed).toEqual({ ok: true, removedRuleId: "r1" });
  });
});

describe("what the editor shows", () => {
  it("titles and summarises the draft, and says whether it changed", () => {
    const state = ruleEditorState(blankDraft({ kind: "internet" }), null);
    expect(state).toMatchObject({ title: "New rule", summary: "All internet · 1 window · 1 UniFi policy", scheduled: true, dirty: true });
    expect(state.writes.map((write) => write.verb)).toEqual(["NEW"]);
    const rule = saved();
    expect(ruleEditorState(fromRule(rule), rule)).toMatchObject({ title: "School nights", dirty: false });
    expect(ruleEditorState({ ...fromRule(rule), name: " " }, rule).title).toBe("School nights");
    expect(ruleEditorState(addWindow(fromRule(rule)), rule)).toMatchObject({ summary: "All internet · 2 windows · 2 UniFi policies", dirty: true });
    expect(ruleEditorState(changeMode(blankDraft({ kind: "app" }), "always"), null).summary).toBe("Apps · always · 1 UniFi policy");
  });

  it("reports overlapping windows only while scheduled", () => {
    const draft = addWindow(addWindow(blankDraft({ kind: "internet" })));
    expect(ruleEditorState(draft, null).overlaps).toHaveLength(1);
    expect(ruleEditorState(changeMode(draft, "always"), null).overlaps).toEqual([]);
  });

  it("offers only the networks FamilyFi manages", () => {
    const networks = [{ id: "n1" }, { id: "n2" }];
    expect(managedNetworks({ networks, manageAllNetworks: false, managedNetworkIds: ["n2"] })).toEqual([{ id: "n2" }]);
    expect(managedNetworks({ networks, manageAllNetworks: true, managedNetworkIds: [] })).toEqual(networks);
    expect(managedNetworks(null)).toEqual([]);
  });

  it("goes back to the group's rules it came from", () => {
    expect(ruleEditorBack(null, [])).toEqual({ href: "/rules", label: "All rules" });
    expect(ruleEditorBack("g1", [{ id: "g1", name: "A child" }])).toEqual({ href: "/rules?group=g1", label: "Rules for A child" });
    expect(ruleEditorBack("gone", []).label).toBe("Rules for this group");
  });

  it("labels windows and their times by what the rule blocks", () => {
    expect(windowTitle({ name: "" }, 1)).toBe("Window 2");
    expect(windowTitle({ name: "Bedtime" }, 1)).toBe("Bedtime");
    expect(windowTimeLabels("internet")).toEqual({ start: "Offline", end: "Back on" });
    expect(windowTimeLabels("app")).toEqual({ start: "Blocked", end: "Until" });
  });

  it("warns how many policies deleting a rule removes", () => {
    expect(deleteRuleCopy(saved()).message).toMatch(/^Removes its UniFi policy/);
    expect(deleteRuleCopy(saved({ policyNames: ["a", "b"] })).message).toMatch(/^Removes all 2 of its UniFi policies/);
    expect(deleteRuleCopy(saved()).title).toBe("Delete “School nights”?");
  });
});
