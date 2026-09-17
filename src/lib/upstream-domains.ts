/** Client-safe canary domains for the upstream DNS category probe. */

export type UpstreamCategory =
  | "adult"
  | "video"
  | "social"
  | "gaming"
  | "vpn"
  | "messaging"
  | "ai"
  | "gambling"
  | "dating";

/**
 * These are a *sample*, not a blocklist. FamilyFi never blocks anything from
 * this file — the probe resolves each domain through the household resolver and
 * infers whether that category is filtered upstream. Twenty per category is a
 * ceiling, not a quota: a category that has fewer domains meeting the rules
 * below carries fewer, because a weak canary costs more than a missing one.
 *
 * Selection rules, in order:
 *
 * 1. **Unambiguously in category.** A borderline domain produces a false
 *    "partial" when the upstream filter reasonably disagrees with us.
 * 2. **Alive.** A dead or parked domain returns NXDOMAIN, which the blocked
 *    predicate reads as *blocked* — so a dead canary silently inflates the
 *    blocked count and can push a category to a false "blocked". Every domain
 *    below resolved when this list was built. Re-check on any edit.
 * 3. **Well known.** An obscure domain may be absent from a filter list that is
 *    working perfectly, producing a false "partial".
 *
 * Provenance: adult validated against the Block List Project `porn` list; video,
 * social, gaming, vpn validated against the Université Toulouse Capitole (UT1)
 * categories `audio-video`, `social_networks`, `games`, `vpn` — CC BY-SA, used
 * here only to check membership of a hand-picked sample, not redistributed.
 * Messaging is hand-picked: UT1's `chat` category is dominated by defunct chat
 * sites that fail rule 2, so it is the weakest category here. AI, gambling and
 * dating come from the UT1 categories of the same names.
 *
 * `ai` and `dating` have no UniFi DPI slot, so DNS is the only layer that can
 * report on them at all.
 */
export const UPSTREAM_CATEGORY_DOMAINS: Record<UpstreamCategory, readonly string[]> = {
  adult: [
    "pornhub.com",
    "xvideos.com",
    "xhamster.com",
    "xnxx.com",
    "redtube.com",
    "youporn.com",
    "onlyfans.com",
    "chaturbate.com",
    "stripchat.com",
    "brazzers.com",
    "spankbang.com",
    "eporner.com",
    "tube8.com",
    "livejasmin.com",
    "bongacams.com",
    "txxx.com",
    "hqporner.com",
    "porntrex.com",
    "beeg.com",
    "thumbzilla.com",
  ],
  video: [
    "netflix.com",
    "youtube.com",
    "hulu.com",
    "primevideo.com",
    "disneyplus.com",
    "max.com",
    "peacocktv.com",
    "paramountplus.com",
    "twitch.tv",
    "vimeo.com",
    "dailymotion.com",
    "crunchyroll.com",
    "pluto.tv",
    "plex.tv",
    "tubi.tv",
    "funimation.com",
    "discoveryplus.com",
    "vudu.com",
    "crackle.com",
    "hotstar.com",
  ],
  social: [
    "facebook.com",
    "instagram.com",
    "tiktok.com",
    "snapchat.com",
    "reddit.com",
    "x.com",
    "twitter.com",
    "pinterest.com",
    "linkedin.com",
    "mastodon.social",
    "vk.com",
    "weibo.com",
    "flickr.com",
    "meetup.com",
    "douyin.com",
    "odnoklassniki.ru",
    "truthsocial.com",
    "gab.com",
    "badoo.com",
    "myspace.com",
  ],
  gaming: [
    "roblox.com",
    "minecraft.net",
    "epicgames.com",
    "steampowered.com",
    "ea.com",
    "ubisoft.com",
    "playstation.com",
    "xbox.com",
    "nintendo.com",
    "battle.net",
    "riotgames.com",
    "leagueoflegends.com",
    "itch.io",
    "gog.com",
    "miniclip.com",
    "poki.com",
    "coolmathgames.com",
    "y8.com",
    "kongregate.com",
    "crazygames.com",
  ],
  vpn: [
    "nordvpn.com",
    "expressvpn.com",
    "protonvpn.com",
    "surfshark.com",
    "cyberghostvpn.com",
    "privateinternetaccess.com",
    "mullvad.net",
    "ipvanish.com",
    "tunnelbear.com",
    "windscribe.com",
    "purevpn.com",
    "hotspotshield.com",
    "hide.me",
    "vyprvpn.com",
    "atlasvpn.com",
    "strongvpn.com",
    "zenmate.com",
    "hidemyass.com",
    "airvpn.org",
    "urban-vpn.com",
  ],
  messaging: [
    "whatsapp.com",
    "telegram.org",
    "discord.com",
    "signal.org",
    "messenger.com",
    "snapchat.com",
    "line.me",
    "viber.com",
    "wechat.com",
    "kik.com",
    "skype.com",
    "imo.im",
    "threema.ch",
    "element.io",
    "groupme.com",
    "icq.com",
    "kakao.com",
    "zalo.me",
    "chatroulette.com",
    "imvu.com",
  ],
  ai: [
    "chatgpt.com",
    "openai.com",
    "claude.ai",
    "anthropic.com",
    "gemini.google.com",
    "copilot.microsoft.com",
    "character.ai",
    "perplexity.ai",
    "deepseek.com",
    "huggingface.co",
    "mistral.ai",
    "grok.com",
    "poe.com",
    "pi.ai",
    "you.com",
    "janitorai.com",
    "llama.com",
    "qwen.ai",
    "suno.com",
    "jasper.ai",
  ],
  gambling: [
    "draftkings.com",
    "fanduel.com",
    "bet365.com",
    "pokerstars.com",
    "williamhill.com",
    "betmgm.com",
    "ladbrokes.com",
    "bwin.com",
    "888casino.com",
    "unibet.com",
    "paddypower.com",
    "betfair.com",
    "stake.com",
    "roobet.com",
    "bovada.lv",
    "betway.com",
    "partypoker.com",
    "skybet.com",
    "betrivers.com",
    "pointsbet.com",
  ],
  /** Nineteen, not twenty: pof.com already covers Plenty of Fish. */
  dating: [
    "tinder.com",
    "bumble.com",
    "hinge.co",
    "match.com",
    "okcupid.com",
    "pof.com",
    "eharmony.com",
    "grindr.com",
    "zoosk.com",
    "happn.com",
    "coffeemeetsbagel.com",
    "meetme.com",
    "ashleymadison.com",
    "jdate.com",
    "christianmingle.com",
    "elitesingles.com",
    "silversingles.com",
    "seeking.com",
    "feeld.co",
  ],
};

/**
 * The ceiling on a *seeded* sample — see the selection rules above. It is not a
 * limit on what a household may add: a customer can grow a list as far as they
 * like, and the UI tells them what it costs in probe time instead.
 */
export const UPSTREAM_SEED_DOMAIN_CEILING = 20;

export const UPSTREAM_CATEGORIES = Object.keys(UPSTREAM_CATEGORY_DOMAINS) as UpstreamCategory[];

export type UpstreamSeedCategory = {
  slug: UpstreamCategory;
  label: string;
  /** 1-3 characters, rendered in the category's tile. */
  monogram: string;
};

/**
 * Parent-facing label and monogram per seeded category. The reconcile keeps these
 * following the shipped seed on every boot; domain membership does not follow, so a
 * household's edits survive an upgrade.
 */
export const UPSTREAM_SEED_CATEGORIES: readonly UpstreamSeedCategory[] = [
  { slug: "adult", label: "Adult", monogram: "18+" },
  { slug: "video", label: "Video", monogram: "VID" },
  { slug: "social", label: "Social", monogram: "SOC" },
  { slug: "gaming", label: "Gaming", monogram: "GAM" },
  { slug: "vpn", label: "VPN", monogram: "VPN" },
  { slug: "messaging", label: "Messaging", monogram: "MSG" },
  { slug: "ai", label: "AI", monogram: "AI" },
  { slug: "gambling", label: "Gambling", monogram: "GMB" },
  { slug: "dating", label: "Dating", monogram: "DAT" },
] as const;

/** Domains probed per run — the cost of one scheduled pass. */
export function upstreamProbeDomainCount(): number {
  return UPSTREAM_CATEGORIES.reduce(
    (total, category) => total + UPSTREAM_CATEGORY_DOMAINS[category].length,
    0,
  );
}
