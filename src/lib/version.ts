import packageJson from "../../package.json";

/** Semver from package.json (no leading v). Keep git release tags as v${APP_VERSION}. */
export const APP_VERSION: string = packageJson.version;

export function appVersionLabel(version = APP_VERSION): string {
  return `v${version.replace(/^v/i, "")}`;
}
