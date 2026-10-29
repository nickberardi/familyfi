/**
 * The words a watch app shows, for familyfi-mobile's native watch apps: the Apple Watch (Swift) and
 * the Wear OS watch (Kotlin). Neither can run this TypeScript, so each keeps a copy and replays
 * `tests/fixtures/display-vectors.json`, which pins these words for both platforms.
 */

/** Which watch: an Apple Watch set up from an iPhone, or a Wear OS watch set up from an Android phone. */
export type WatchPlatform = "apple" | "wear";

/** The platform's word for the watch, mid-sentence: Apple's product name, or the plain noun on Wear OS. */
export function watchNoun(platform: WatchPlatform): string {
  return platform === "apple" ? "Watch" : "watch";
}

/** The platform's word for the phone that sets a watch up, mid-sentence. */
export function watchPhoneNoun(platform: WatchPlatform): string {
  return platform === "apple" ? "iPhone" : "phone";
}

/** What the watch app says, on the given platform. */
export function watchAppCopy(platform: WatchPlatform) {
  const watch = watchNoun(platform);
  const phone = watchPhoneNoun(platform);
  return {
    title: "FamilyFi",
    setupTitle: `Set up on ${phone}`,
    setupBody: `Open FamilyFi on your ${phone}, then More → Watch.`,
    signedOutTitle: "Signed out",
    signedOutBody: `Set up this ${watch} again in FamilyFi on your ${phone}.`,
    loading: "Checking FamilyFi",
    offlineTitle: "Can't reach FamilyFi",
    offlineBody: "Trying again…",
    noGroups: `Choose groups in FamilyFi on your ${phone}.`,
    notAvailable: "Not available",
    applying: "Applying…",
    stale: "Checking FamilyFi… Controls are off until it answers.",
    rules: "Rules",
    applied: "Applied.",
    notApplied: "The change did not fully apply.",
    superseded: "A newer change replaced this one.",
    stillApplying: "Still applying. Check the group before trying again.",
    unconfirmed: "Couldn't confirm the change. Check the group before trying again.",
    unreachable: "Can't reach FamilyFi.",
    signedOutError: `This ${watch} is signed out. Set it up again from the ${phone}.`,
    notAllowed: `This ${watch} can't do that.`,
    unexpected: "FamilyFi answered unexpectedly.",
    refused: "FamilyFi refused the request.",
    // When this watch app and the server can't read each other (`api-compat.ts`); nothing else shows.
    updateAppTitle: `Update FamilyFi on your ${phone}`,
    updateAppBody: "Your FamilyFi server was updated, and this app can't work with it.",
    updateServerTitle: "Your server needs an update",
    updateServerBody: `Update it from FamilyFi on your ${phone} or computer.`,
  };
}
