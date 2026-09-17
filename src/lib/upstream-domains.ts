/** Client-safe canary domains for the upstream DNS category probe. */

export type UpstreamCategory = "adult" | "video" | "social" | "gaming" | "vpn" | "messaging";

/**
 * These are a *sample*, not a blocklist. FamilyFi never blocks anything from
 * this file — the probe resolves each domain through the household resolver and
 * infers whether that category is filtered upstream. Twenty per category keeps a
 * daily run at 120 queries, small enough to be unremarkable to any resolver.
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
 * sites that fail rule 2, so it is the weakest category here.
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
};

export const UPSTREAM_CATEGORIES = Object.keys(UPSTREAM_CATEGORY_DOMAINS) as UpstreamCategory[];

/** Domains probed per run — the cost of one scheduled pass. */
export function upstreamProbeDomainCount(): number {
  return UPSTREAM_CATEGORIES.reduce(
    (total, category) => total + UPSTREAM_CATEGORY_DOMAINS[category].length,
    0,
  );
}
