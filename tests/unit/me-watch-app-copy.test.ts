import { describe, expect, it } from "vitest";

import { meWatchAppCopy } from "@/lib/watch-app-copy";

describe("meWatchAppCopy", () => {
  it("names the iPhone and the Watch on Apple Watch", () => {
    const copy = meWatchAppCopy("apple");
    expect(copy.openTitle).toBe("Open FamilyFi Me on your iPhone");
    expect(copy.setUpLine).toBe("This Watch sets itself up from there.");
    expect(copy.updatesLine).toBe("This Watch updates from there.");
    expect(copy.notOpen).toBe("Open FamilyFi Me on your iPhone to send this.");
  });

  it("says phone and watch on Wear OS", () => {
    const copy = meWatchAppCopy("wear");
    expect(copy.openTitle).toBe("Open FamilyFi Me on your phone");
    expect(copy.setUpLine).toBe("This watch sets itself up from there.");
    expect(copy.updatesLine).toBe("This watch updates from there.");
    expect(copy.notOpen).toBe("Open FamilyFi Me on your phone to send this.");
  });

  it("names the app, the Things and the complication", () => {
    const copy = meWatchAppCopy("apple");
    expect(copy.title).toBe("FamilyFi Me");
    expect(copy.things).toBe("Things");
    expect(copy.nextChange).toBe("Next change");
    expect(copy.nextChangeAbout).toBe("When your next block starts or ends.");
  });

  it("says the same words on both watches where the platforms don't differ", () => {
    const apple = meWatchAppCopy("apple");
    const wear = meWatchAppCopy("wear");
    for (const key of ["title", "things", "nextChange", "nextChangeAbout"] as const) expect(wear[key]).toBe(apple[key]);
  });
});
