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

	test("renders a multi-day event as one spanning block", async ({ page }) => {
		await page.goto(PREVIEW_URL);

		// Pokémon GO Fest 2026 (Fri–Sun) is drawn as a single block spanning its
		// day columns, not repeated once per day.
		const block = page
			.locator('[style*="grid-column"]')
			.filter({ hasText: "Pokémon GO Fest 2026" });
		await expect(block).toHaveCount(1);
		// Friday is column 5 (Mon-first), Fri→Sun covers 3 columns.
		await expect(block).toHaveAttribute("style", /grid-column:\s*5 \/ span 3/);
	});

	test("non-overlapping multi-day events share one band row", async ({
		page,
	}) => {
		await page.goto(PREVIEW_URL);

		// Malta-tur (Mon–Tue) and Konference (Wed–Thu) don't overlap, so they pack
		// onto the same row (same Y) rather than stacking under each other.
		const malta = page.getByText("Malta-tur");
		const konference = page.getByText("Konference");
		await expect(malta).toBeVisible();
		await expect(konference).toBeVisible();

		const a = await malta.boundingBox();
		const b = await konference.boundingBox();
		if (!a || !b) throw new Error("span blocks were not laid out");

		// Same vertical position (allowing sub-pixel rounding)…
		expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
		// …and side by side (Konference is to the right of Malta-tur).
		expect(b.x).toBeGreaterThan(a.x);
	});

	test("a combined event shows both calendars' colours (striped)", async ({
		page,
	}) => {
		await page.goto(PREVIEW_URL);

		// Scouts is on Bjørn (black) + Irena (blue) → the single combined event,
		// rendered as one striped marker carrying both colours.
		const striped = page.locator('[style*="repeating-linear-gradient"]');
		await expect(striped).toHaveCount(1);

		const style = (await striped.getAttribute("style"))?.toLowerCase() ?? "";
		expect(style).toContain("#000000"); // Bjørn
		expect(style).toContain("#0000ff"); // Irena

		// The striped marker sits in the same event as "Scouts".
		await expect(
			page
				.locator("div")
				.filter({ has: striped })
				.filter({ hasText: "Scouts" })
				.last(),
		).toContainText("Scouts");
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
