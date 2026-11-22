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

  it("says the same words on both watches where the platforms don't differ", () => {
    const { openTitle, setUpLine, updatesLine, notOpen, ...rest } = meWatchAppCopy("apple");
    const wear = meWatchAppCopy("wear");
    for (const [key, words] of Object.entries(rest)) expect(wear[key as keyof typeof wear]).toBe(words);
    expect([openTitle, setUpLine, updatesLine, notOpen].join(" ")).not.toMatch(/child/i);
  });
});
