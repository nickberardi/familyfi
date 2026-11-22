/**
 * The words a watch app shows, for familyfi-mobile's native watch apps: the Apple Watch (Swift) and
 * the Wear OS watch (Kotlin). Neither can run this TypeScript, so each keeps a copy and replays
 * `tests/fixtures/display-vectors.json`, which pins these words for both platforms. FamilyFi Me's
 * watch apps' words (`meWatchAppCopy`) have no vectors: familyfi-mobile-me's tests check its Swift
 * and Kotlin spell them as here.
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

/**
 * What FamilyFi Me's watch app says around the day its phone hands over, on the given platform, for
 * familyfi-mobile-me's Apple Watch (Swift) and Wear OS (Kotlin) apps. The day's own lines come with
 * the day; these are the words a watch shows before it has one, or around it. Each app spells them
 * once, and familyfi-mobile-me's tests check that it spells them as here.
 */
export function meWatchAppCopy(platform: WatchPlatform) {
  const watch = watchNoun(platform);
  const phone = watchPhoneNoun(platform);
  return {
    title: "FamilyFi Me",
    /** Before the phone handed a day over, or once it ran out. */
    openTitle: `Open FamilyFi Me on your ${phone}`,
    setUpLine: `This ${watch} sets itself up from there.`,
    updatesLine: `This ${watch} updates from there.`,
    /** An ask the watch can't send yet, because the phone hasn't set it up. */
    notOpen: `Open FamilyFi Me on your ${phone} to send this.`,
    /** Over the Things a parent shares, under the person's own day. */
    things: "Things",
    /** The complication's (and on Apple Watch the Smart Stack card's) name in the face's gallery. */
    nextChange: "Next change",
    /** Its line under that name, on Apple Watch; Wear OS's gallery shows a name only. */
    nextChangeAbout: "When your next block starts or ends.",
  };
}
