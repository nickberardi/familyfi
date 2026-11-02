# Security

## Reporting a vulnerability

Report it privately through a [GitHub security advisory](https://github.com/nickberardi/familyfi/security/advisories/new) on this repository. Please do not open a public issue, pull request or discussion. Replies come on the advisory, and a fix is published with a new release before the advisory is made public.

Do not include UniFi API keys, household exports or dumps, or `.env` contents in a report or an issue. Remove credentials and IP addresses from logs first.

## In scope

- The FamilyFi server and web app in this repository, and the image published at `ghcr.io/nickberardi/familyfi`.
- The companion app for iPhone, iPad, Apple Watch and Android ([familyfi-mobile](https://github.com/nickberardi/familyfi-mobile)) and how it pairs with and connects to a server.
- Remote access through the phone gateway, and the Cloudflare tunnel FamilyFi can run for a household.

These are out of scope: the public demo's published sign-in (demo.getfamilyfi.com resets every night, and its changes are locked), weaknesses in UniFi, Docker or Cloudflare themselves, and anything that needs an administrator's own password or Integration API key.

## Supported versions

Security fixes go into the newest release on the `latest` tag. Keep automatic updates on, or install the newest release from the Updates card in **Settings → Maintenance**. A household pinned to an older line with `FAMILYFI_UPDATE_TAG` gets a fix only if that line is patched.
