import { getBrowser } from "@/lib/recipes/chrome-pool";

/**
 * Render a complete HTML document to a PNG buffer using Puppeteer.
 *
 * Uses the "sandboxed" Chrome profile — web security stays ON because the
 * HTML originates from user-authored Liquid recipes in the DB.
 */
export async function renderHtmlToImage(
	html: string,
	width: number,
	height: number,
): Promise<Buffer> {
	const browser = await getBrowser("sandboxed");
	const page = await browser.newPage();
	try {
		await page.setViewport({ width, height });
		// `load` fires on DOMContentLoaded + main resources (CSS, fonts, primary
		// images). Avoids `networkidle0`, which hangs whenever a liquid recipe
		// keeps a long-poll, analytics ping, or background image fetch open —
		// common enough that strict idle-wait timed out for nearly every recipe.
		await page.setContent(html, {
			waitUntil: "load",
			timeout: 30000,
		});
		const screenshot = await page.screenshot({
			type: "png",
			clip: { x: 0, y: 0, width, height },
		});
		return Buffer.from(screenshot);
	} finally {
		await page.close();
	}
}
