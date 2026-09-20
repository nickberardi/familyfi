/** Client-safe canary domains for the upstream DNS category probe. */

import type { IconName } from "./icons";

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
  /** The glyph the tile draws. The monogram stays as the fallback beneath it. */
  icon: IconName;
};

/**
 * Parent-facing label, monogram and glyph per seeded category. The reconcile keeps
 * these following the shipped seed on every boot; domain membership does not follow,
 * so a household's edits survive an upgrade.
 *
 * Only a seeded category has a glyph. A household can invent a category and there is
 * no icon to give it, so an invented one keeps its monogram — which is why the
 * monogram is still stored for every category, seeded ones included.
 */
export const UPSTREAM_SEED_CATEGORIES: readonly UpstreamSeedCategory[] = [
  { slug: "adult", label: "Adult", monogram: "18+", icon: "prohibit" },
  { slug: "video", label: "Video", monogram: "VID", icon: "play-circle" },
  { slug: "social", label: "Social", monogram: "SOC", icon: "users-three" },
  { slug: "gaming", label: "Gaming", monogram: "GAM", icon: "game-controller" },
  { slug: "vpn", label: "VPN", monogram: "VPN", icon: "shield-check" },
  { slug: "messaging", label: "Messaging", monogram: "MSG", icon: "chat-circle" },
  { slug: "ai", label: "AI", monogram: "AI", icon: "sparkle" },
  { slug: "gambling", label: "Gambling", monogram: "GMB", icon: "poker-chip" },
  { slug: "dating", label: "Dating", monogram: "DAT", icon: "heart" },
] as const;

/**
 * The glyph for a category's tile, or `undefined` for one the household invented.
 *
 * Keyed on the slug rather than the source alone: a household could name a category
 * `video` of its own, and it would still be its own list of domains, not the seed.
 */
export function upstreamCategoryIcon(
  slug: string,
  source: "seed" | "user",
): IconName | undefined {
  if (source !== "seed") return undefined;
  return UPSTREAM_SEED_CATEGORIES.find((category) => category.slug === slug)?.icon;
}

/** Domains probed per run — the cost of one scheduled pass. */
export function upstreamProbeDomainCount(): number {
  return UPSTREAM_CATEGORIES.reduce(
    (total, category) => total + UPSTREAM_CATEGORY_DOMAINS[category].length,
    0,
  );
}

/** Queries the probe keeps in flight. */
export const UPSTREAM_PROBE_CONCURRENCY = 4;

/**
 * A typical resolver round trip. The estimate deliberately uses this rather than the
 * configured timeout: a note that quotes the worst case reads as a warning about
 * every pass, when a timeout only costs that much on a resolver that is failing.
 */
export const UPSTREAM_PROBE_NOMINAL_MS = 120;

/** Where the cost note starts telling the customer that growth has a price. */
export const UPSTREAM_PROBE_NOTICE_DOMAINS = 30;

/** Rough seconds for one pass over `activeDomains`, rounded up to a whole second. */
export function estimateProbeSeconds(activeDomains: number): number {
  if (activeDomains <= 0) return 0;
  const waves = Math.ceil(activeDomains / UPSTREAM_PROBE_CONCURRENCY);
  return Math.max(1, Math.ceil((waves * UPSTREAM_PROBE_NOMINAL_MS) / 1000));
}

/**
 * The line under a category's domain list. Decision: lists are never capped, so this
 * is the whole mechanism for telling a customer what adding more costs.
 */
export function probeCostNote(activeDomains: number): string {
  const seconds = estimateProbeSeconds(activeDomains);
  return activeDomains > UPSTREAM_PROBE_NOTICE_DOMAINS
    ? `A full pass now takes about ${seconds}s — adding more domains makes it take longer.`
    : `A full pass takes about ${seconds}s.`;
}
