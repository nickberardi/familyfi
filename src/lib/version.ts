import packageJson from "../../package.json";

import { versionLabel } from "./update-copy";

/** Semver from package.json (no leading v). Keep git release tags as v${APP_VERSION}. */
export const APP_VERSION: string = packageJson.version;

export function appVersionLabel(version = APP_VERSION): string {
  return versionLabel(version);
}
