import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e config.
 *
 * By default Playwright starts its own Next dev server with
 * GOOGLE_CALENDAR_FIXTURE=true, so the google-calendar recipe renders from
 * deterministic fixture data (no Google account needed). Other env
 * (DATABASE_URL, etc.) is loaded from .env.local by Next itself.
 *
 * Note: Next only allows one `next dev` per project, so the managed server
 * cannot start while a normal `pnpm dev` is running. To run e2e against an
 * already-running instance, point at it and skip the managed server:
 *
 *   GOOGLE_CALENDAR_FIXTURE=true pnpm dev      # in one terminal
 *   E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
 */

const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// When E2E_BASE_URL is set, assume the server is already running.
	webServer: EXTERNAL_BASE_URL
		? undefined
		: {
				command: `next dev --turbopack --port ${PORT}`,
				url: BASE_URL,
				reuseExistingServer: !process.env.CI,
				timeout: 180_000,
				env: {
					GOOGLE_CALENDAR_FIXTURE: "true",
					AUTH_ENABLED: "false",
				},
			},
});
