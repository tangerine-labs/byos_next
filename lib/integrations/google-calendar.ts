import crypto from "node:crypto";
import { sql } from "kysely";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { Temporal } from "@/lib/temporal";

/**
 * Google Calendar integration: OAuth 2.0 (read-only) + Calendar REST API access,
 * with AES-256-GCM encryption of tokens at rest.
 *
 * Server-only. Deliberately uses plain `fetch` against Google's REST endpoints
 * rather than the heavy `googleapis` SDK (matches the `weather` recipe pattern
 * and keeps the serverless bundle small).
 *
 * Persistence lives in `google_calendar_credentials` (migration 0015), one row
 * per user, always accessed through `withExplicitUserScope` so RLS scopes it to
 * the owner. The device render path has no browser session, so this is the only
 * way it can mint a fresh access token on the user's behalf.
 */

export const GOOGLE_CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// Refresh a little before actual expiry so a render never races the deadline.
const EXPIRY_SKEW_SECONDS = 60;

// Short-lived CSRF cookie name for the OAuth handshake.
export const GOOGLE_STATE_COOKIE = "g_oauth_state";

/** Externally-visible origin, honouring reverse-proxy headers. */
export function originFromHeaders(headers: Headers): string {
	const proto = headers.get("x-forwarded-proto") || "http";
	const host =
		headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
	return `${proto}://${host}`;
}

/** The OAuth redirect URI; must match a value registered in Google Cloud. */
export function googleCallbackUrl(origin: string): string {
	return `${origin}/api/integrations/google/callback`;
}

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------

export function isGoogleOAuthConfigured(): boolean {
	return Boolean(
		process.env.GOOGLE_CLIENT_ID &&
			process.env.GOOGLE_CLIENT_SECRET &&
			process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
	);
}

function requireClientCredentials(): {
	clientId: string;
	clientSecret: string;
} {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			"Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
		);
	}
	return { clientId, clientSecret };
}

// -----------------------------------------------------------------------------
// Token encryption (AES-256-GCM). Stored format: base64(iv | authTag | cipher).
// -----------------------------------------------------------------------------

function getEncryptionKey(): Buffer {
	const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			"GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
		);
	}
	// Accept hex (64 chars) or base64; must decode to exactly 32 bytes.
	const key = /^[0-9a-fA-F]{64}$/.test(raw)
		? Buffer.from(raw, "hex")
		: Buffer.from(raw, "base64");
	if (key.length !== 32) {
		throw new Error(
			"GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (use: openssl rand -hex 32).",
		);
	}
	return key;
}

export function encryptToken(plaintext: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
	const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(payload: string): string {
	const buf = Buffer.from(payload, "base64");
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const enc = buf.subarray(28);
	const decipher = crypto.createDecipheriv(
		"aes-256-gcm",
		getEncryptionKey(),
		iv,
	);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
		"utf8",
	);
}

// -----------------------------------------------------------------------------
// OAuth flow
// -----------------------------------------------------------------------------

/**
 * Build the Google consent URL. `access_type=offline` + `prompt=consent` are
 * what make Google return a long-lived refresh_token (the piece we persist).
 */
export function buildAuthUrl(redirectUri: string, state: string): string {
	const { clientId } = requireClientCredentials();
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: GOOGLE_CALENDAR_SCOPE,
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
		state,
	});
	return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string;
	token_type: string;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
	const res = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Google token endpoint failed (${res.status}): ${text}`);
	}
	return (await res.json()) as TokenResponse;
}

export async function exchangeCode(
	code: string,
	redirectUri: string,
): Promise<TokenResponse> {
	const { clientId, clientSecret } = requireClientCredentials();
	return postToken(
		new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	);
}

export async function refreshAccessToken(
	refreshToken: string,
): Promise<TokenResponse> {
	const { clientId, clientSecret } = requireClientCredentials();
	return postToken(
		new URLSearchParams({
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: "refresh_token",
		}),
	);
}

/** Fetch the signed-in user's email, used purely as a label in the dashboard. */
export async function fetchGoogleEmail(
	accessToken: string,
): Promise<string | null> {
	try {
		const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { email?: string };
		return data.email ?? null;
	} catch {
		return null;
	}
}

// -----------------------------------------------------------------------------
// Calendar REST API
// -----------------------------------------------------------------------------

export type GoogleCalendarListEntry = {
	id: string;
	summary: string;
	primary?: boolean;
	selected?: boolean;
	backgroundColor?: string;
	accessRole?: string;
};

export async function listCalendars(
	accessToken: string,
): Promise<GoogleCalendarListEntry[]> {
	const res = await fetch(
		`${CALENDAR_API}/users/me/calendarList?minAccessRole=reader&fields=items(id,summary,primary,selected,backgroundColor,accessRole)`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	if (!res.ok) {
		throw new Error(`Google calendarList failed (${res.status})`);
	}
	const data = (await res.json()) as { items?: GoogleCalendarListEntry[] };
	return data.items ?? [];
}

export type GoogleEvent = {
	id: string;
	summary?: string;
	start: { date?: string; dateTime?: string; timeZone?: string };
	end: { date?: string; dateTime?: string; timeZone?: string };
	status?: string;
};

export async function listEvents(
	accessToken: string,
	calendarId: string,
	timeMinISO: string,
	timeMaxISO: string,
): Promise<GoogleEvent[]> {
	const params = new URLSearchParams({
		singleEvents: "true",
		orderBy: "startTime",
		timeMin: timeMinISO,
		timeMax: timeMaxISO,
		maxResults: "2500",
		fields: "items(id,summary,start,end,status)",
	});
	const res = await fetch(
		`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	if (!res.ok) {
		// One bad calendar shouldn't sink the whole render.
		return [];
	}
	const data = (await res.json()) as { items?: GoogleEvent[] };
	return (data.items ?? []).filter((e) => e.status !== "cancelled");
}

// -----------------------------------------------------------------------------
// Persistence (RLS-scoped)
// -----------------------------------------------------------------------------

export type StoredCredentials = {
	refresh_token_enc: string;
	access_token_enc: string | null;
	access_token_expires_at: Date | null;
	scope: string | null;
	google_email: string | null;
};

export async function getStoredCredentials(
	userId: string,
): Promise<StoredCredentials | undefined> {
	return withExplicitUserScope(userId, (scopedDb) =>
		scopedDb
			.selectFrom("google_calendar_credentials")
			.select([
				"refresh_token_enc",
				"access_token_enc",
				"access_token_expires_at",
				"scope",
				"google_email",
			])
			.where("user_id", "=", userId)
			.executeTakeFirst(),
	) as Promise<StoredCredentials | undefined>;
}

export async function isCalendarConnected(userId: string): Promise<boolean> {
	const row = await getStoredCredentials(userId);
	return Boolean(row);
}

/** Upsert the full credential set after a successful OAuth consent. */
export async function saveCredentials(
	userId: string,
	creds: {
		refreshToken: string;
		accessToken: string;
		expiresInSeconds: number;
		scope?: string | null;
		email?: string | null;
	},
): Promise<void> {
	const expiresAt = Temporal.Now.instant()
		.add({ seconds: creds.expiresInSeconds })
		.toString();
	await withExplicitUserScope(userId, (scopedDb) =>
		scopedDb
			.insertInto("google_calendar_credentials")
			.values({
				user_id: userId,
				refresh_token_enc: encryptToken(creds.refreshToken),
				access_token_enc: encryptToken(creds.accessToken),
				access_token_expires_at: expiresAt,
				scope: creds.scope ?? null,
				google_email: creds.email ?? null,
				updated_at: sql`now()`,
			} as never)
			.onConflict((oc) =>
				oc.column("user_id").doUpdateSet({
					refresh_token_enc: encryptToken(creds.refreshToken),
					access_token_enc: encryptToken(creds.accessToken),
					access_token_expires_at: expiresAt,
					scope: creds.scope ?? null,
					google_email: creds.email ?? null,
					updated_at: sql`now()`,
				} as never),
			)
			.execute(),
	);
}

export async function deleteCredentials(userId: string): Promise<void> {
	await withExplicitUserScope(userId, (scopedDb) =>
		scopedDb
			.deleteFrom("google_calendar_credentials")
			.where("user_id", "=", userId)
			.execute(),
	);
}

async function persistRefreshedAccessToken(
	userId: string,
	accessToken: string,
	expiresInSeconds: number,
): Promise<void> {
	const expiresAt = Temporal.Now.instant()
		.add({ seconds: expiresInSeconds })
		.toString();
	await withExplicitUserScope(userId, (scopedDb) =>
		scopedDb
			.updateTable("google_calendar_credentials")
			.set({
				access_token_enc: encryptToken(accessToken),
				access_token_expires_at: expiresAt,
				updated_at: sql`now()`,
			} as never)
			.where("user_id", "=", userId)
			.execute(),
	);
}

/**
 * Return a usable access token for the user, refreshing (and persisting) it when
 * the cached one is missing or within {@link EXPIRY_SKEW_SECONDS} of expiry.
 * Returns null when the user has not connected a Google account.
 */
export async function getValidAccessToken(
	userId: string,
): Promise<string | null> {
	const row = await getStoredCredentials(userId);
	if (!row) return null;

	const nowEpochMs = Temporal.Now.instant().epochMilliseconds;
	const stillValid =
		row.access_token_enc &&
		row.access_token_expires_at &&
		row.access_token_expires_at.getTime() - nowEpochMs >
			EXPIRY_SKEW_SECONDS * 1000;

	if (stillValid && row.access_token_enc) {
		return decryptToken(row.access_token_enc);
	}

	const refreshed = await refreshAccessToken(
		decryptToken(row.refresh_token_enc),
	);
	await persistRefreshedAccessToken(
		userId,
		refreshed.access_token,
		refreshed.expires_in,
	);
	return refreshed.access_token;
}
