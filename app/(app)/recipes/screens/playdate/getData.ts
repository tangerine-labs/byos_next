import { unstable_cache } from "next/cache";
import sharp from "sharp";

// Mark as dynamic so a fresh game can be picked on each render (the recipe
// "cycles" through Playdate Catalog titles by choosing a random game per render).
export const dynamic = "force-dynamic";

// Playdate feature art is a uniform 1600x960 — exactly 2x the 800x480 panel
// (identical 5:3 aspect). We pre-downscale to the panel size with sharp so the
// final image lands on the panel at an exact 1:2 ratio via a high-quality
// Lanczos filter, instead of relying on the render engine's image scaler.
const PANEL_WIDTH = 800;
const PANEL_HEIGHT = 480;

export interface PlaydateData {
	/**
	 * Title-card image, pre-resized to the panel (800x480) as a grayscale PNG
	 * data URI for an exact 1:2 downscale. Falls back to the remote 1600x960 URL.
	 */
	imageUrl: string;
	/** Game name, e.g. "ClayDate". */
	name: string;
	/** Developer / studio, e.g. "Itamar Ernst". */
	developer: string;
	/** Catalog slug, e.g. "claydate". */
	slug: string;
}

interface PlaydateParams {
	gameSlug?: string;
}

const CATALOG_INDEX = "https://play.date/games/";
const GAME_BASE = "https://play.date/games/";
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Curated pool of stable Catalog permalinks. The live catalog index only
// surfaces the current week's featured games, so this seed keeps the recipe
// working year-round. Unknown/removed slugs simply 404 and are skipped.
const CURATED_SLUGS = [
	"mars-after-midnight",
	"the-botanist",
	"sasquatchers",
	"ratcheteer",
	"b360",
	"demon-quest-85",
	"bloom",
	"inventory-hero",
	"whitewater-wipeout",
	"casual-birder",
	"the-magician",
	"claydate",
	"scope",
	"crankboy",
	"water-flow",
	"under-the-tree",
	"under-the-castle",
	"geodate",
	"beampunk",
	"bear-coin-blitz",
	"cannonball-kid",
	"chaos-studies",
	"crankominoes",
	"crankwords",
	"devils-on-the-moon-pinball",
	"eggberts-bird-bath",
	"ladeira-abaixo",
	"maybe-monday",
	"office-chair-curling",
	"pin-finger",
	"reel-istic-fishing",
	"rollerblade",
	"switchboard-shuffle",
];

// Last-resort fallback so the screen always renders something on-brand.
const DEFAULT_GAME: PlaydateData = {
	imageUrl:
		"https://media-cdn.play.date/media/games/486467/website_feature_image_composite_6A68OUB.png",
	name: "ClayDate",
	developer: "Itamar Ernst",
	slug: "claydate",
};

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();

/**
 * Fetch the remote title card and downscale it to the exact panel size with a
 * Lanczos filter, returned as a grayscale PNG data URI. This guarantees a clean
 * integer (1:2) downscale before the 1-bit dithering step. Falls back to the
 * original remote URL if the fetch/resize fails.
 */
async function toPanelDataUri(url: string): Promise<string> {
	try {
		const res = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return url;
		const input = Buffer.from(await res.arrayBuffer());
		const png = await sharp(input)
			.resize(PANEL_WIDTH, PANEL_HEIGHT, {
				kernel: sharp.kernel.lanczos3,
				fit: "cover",
			})
			.grayscale()
			.png()
			.toBuffer();
		return `data:image/png;base64,${png.toString("base64")}`;
	} catch {
		return url;
	}
}

/**
 * Scrape the live catalog index for currently-featured game slugs and merge
 * them with the curated pool. Cached for 12h; failures fall back to curated.
 */
const getSlugPool = unstable_cache(
	async (): Promise<string[]> => {
		const pool = new Set(CURATED_SLUGS);
		try {
			const res = await fetch(CATALOG_INDEX, {
				headers: { "User-Agent": USER_AGENT },
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				const html = await res.text();
				// Named slugs only (skip numeric ids and catalog meta pages).
				const matches = html.matchAll(/\/games\/([a-z][a-z0-9-]+)\//g);
				const skip = new Set([
					"catalog",
					"collections",
					"gamegroups",
					"tags",
					"staff-picks",
					"quick-plays",
					"search",
					"seasons",
					"season-one",
					"season-two",
					"new",
					"all",
				]);
				for (const m of matches) {
					if (!skip.has(m[1])) pool.add(m[1]);
				}
			}
		} catch {
			console.warn("[playdate] catalog index fetch failed, using curated pool");
		}
		return Array.from(pool);
	},
	["playdate-slug-pool"],
	{ tags: ["playdate"], revalidate: 12 * 60 * 60 },
);

/**
 * Resolve a single game's title-card image + metadata from its detail page.
 * Cached per-slug for 24h. Returns null when the game can't be resolved.
 */
const resolveGame = unstable_cache(
	async (slug: string): Promise<PlaydateData | null> => {
		try {
			const res = await fetch(`${GAME_BASE}${slug}/`, {
				headers: { "User-Agent": USER_AGENT },
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) return null;
			const html = await res.text();

			const imageUrl = html.match(
				/https:\/\/media-cdn\.play\.date\/media\/games\/\d+\/[^"']*website_feature_image_composite[^"']*\.(?:png|jpg|jpeg)/i,
			)?.[0];
			if (!imageUrl) return null;

			const rawTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
			const name = rawTitle.replace(/^Playdate game\s*/i, "").trim() || slug;

			const developer =
				stripTags(html.match(/Made by\s+([^<]+)/i)?.[1] ?? "")
					.replace(/\s+/g, " ")
					.trim() || "Playdate Catalog";

			// Pre-resize to the panel so the panel gets an exact 1:2 downscale.
			const panelImage = await toPanelDataUri(imageUrl);

			return { imageUrl: panelImage, name, developer, slug };
		} catch {
			return null;
		}
	},
	["playdate-game-v2"],
	{ tags: ["playdate"], revalidate: 24 * 60 * 60 },
);

const pickRandom = <T>(arr: T[]): T =>
	arr[Math.floor(Math.random() * arr.length)];

export default async function getData(
	params?: PlaydateParams,
): Promise<PlaydateData> {
	// Allow pinning a specific game via the recipe param.
	if (params?.gameSlug) {
		const pinned = await resolveGame(params.gameSlug.trim());
		if (pinned) return pinned;
	}

	const pool = await getSlugPool();

	// Try a few random games so a single 404/parse failure doesn't blank the
	// screen — this is also what produces the "cycling" between renders.
	const tried = new Set<string>();
	for (let i = 0; i < 4 && tried.size < pool.length; i++) {
		const slug = pickRandom(pool);
		if (tried.has(slug)) continue;
		tried.add(slug);
		const game = await resolveGame(slug);
		if (game) return game;
	}

	return DEFAULT_GAME;
}
