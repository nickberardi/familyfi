import type { ErrorLink } from "./api-client";

/** What the web app says on every page in demo mode (`FAMILYFI_MODE=demo`): nothing here is real or kept. */
export const DEMO_NOTICE = "Demo, resets nightly. The household and gateway are simulated, and changes are cleared every night.";

/** Where a locked demo setting points: installing FamilyFi at home (the README's Install). */
export const DEMO_SET_UP_LINK: ErrorLink = { label: "Set up your own", url: "https://github.com/nickberardi/familyfi#install" };

export const DEMO_SIGN_IN_NOTE = "Anyone can try the demo with this login. It's filled in for you, and settings are locked.";
