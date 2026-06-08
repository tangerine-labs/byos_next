import { expect, test } from "@playwright/test";

/**
 * Exercises the google-calendar recipe with deterministic fixture data — the
 * test server runs with GOOGLE_CALENDAR_FIXTURE=true (see playwright.config.ts
 * and app/(app)/recipes/screens/google-calendar/fixtures.ts), so no live Google
 * account is needed. The public preview route runs the real component + getData
 * and emits HTML we can assert on; the device bitmap endpoint exercises the full
 * render pipeline.
 *
 * Fine-grained scheduling/colour/merge logic is unit-testable directly via the
 * pure `assembleCalendarPayload` + `googleCalendarFixture` exports.
 */

const PREVIEW_URL = "/recipes/google-calendar/preview?width=1600&height=1200";

test.beforeAll(async ({ request }) => {
	// Warm the dashboard so syncReactRecipes() upserts the recipe row that the
	// preview/bitmap routes read (no-op if already synced).
	await request.get("/recipes");
});

test.describe("google-calendar recipe (fixture data)", () => {
	test("preview renders every fixture event and calendar", async ({ page }) => {
		await page.goto(PREVIEW_URL);
		const body = page.locator("body");

		// Training: Mon/Wed/Fri mornings (06.30).
		await expect(body).toContainText("Training");
		await expect(body).toContainText("06.30");

		// Scouts: Wednesday evening (18.00), on Bjørn + Irena.
		await expect(body).toContainText("Scouts");
		await expect(body).toContainText("18.00");

		// Pokémon GO Fest 2026: all-day Friday–Sunday.
		await expect(body).toContainText("Pokémon GO Fest 2026");
		await expect(body).toContainText("hele dagen");

		// Two same-day holidays collapse into a single entry.
		await expect(body).toContainText("Grundlovsdag");
		await expect(body).toContainText("Sveriges nationaldag");

		// Legend lists every calendar.
		for (const name of [
			"Danske helligdage",
			"Svenska helgdagar",
			"Bjørn",
			"Irena",
		]) {
			await expect(body).toContainText(name);
		}
	});

	test("device bitmap renders a populated calendar", async ({ request }) => {
		const res = await request.get(
			"/api/bitmap/google-calendar.png?width=1600&height=1200",
		);
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"]).toContain("image/png");

		const png = await res.body();
		// PNG magic number.
		expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		// A populated week view is far larger than the ~2KB "not connected" card,
		// confirming the fixture events actually rendered.
		expect(png.byteLength).toBeGreaterThan(5000);
	});
});
