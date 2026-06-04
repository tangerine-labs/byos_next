import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/get-user";
import {
	exchangeCode,
	fetchGoogleEmail,
	GOOGLE_STATE_COOKIE,
	googleCallbackUrl,
	originFromHeaders,
	saveCredentials,
} from "@/lib/integrations/google-calendar";
import { logError } from "@/lib/logger";

const RETURN_PATH = "/recipes/google-calendar";

export async function GET(request: NextRequest) {
	const origin = originFromHeaders(request.headers);
	const back = (status: string) =>
		NextResponse.redirect(`${origin}${RETURN_PATH}?google=${status}`);

	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const state = searchParams.get("state");
	const error = searchParams.get("error");

	if (error) {
		// User declined consent, or Google rejected the request.
		return back("denied");
	}

	const expectedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
	if (!code || !state || !expectedState || state !== expectedState) {
		return back("state_mismatch");
	}

	// The token must be attached to a concrete user. In mono-user mode this is
	// byos_mono_user; with auth enabled it's the signed-in dashboard user.
	const userId = await getCurrentUserId();
	if (!userId) {
		return back("not_signed_in");
	}

	try {
		const tokens = await exchangeCode(code, googleCallbackUrl(origin));

		if (!tokens.refresh_token) {
			// Google only returns a refresh_token on first consent unless
			// prompt=consent is used (we do). If it's still missing, the prior
			// grant must be revoked at myaccount.google.com/permissions.
			return back("no_refresh_token");
		}

		const email = await fetchGoogleEmail(tokens.access_token);
		await saveCredentials(userId, {
			refreshToken: tokens.refresh_token,
			accessToken: tokens.access_token,
			expiresInSeconds: tokens.expires_in,
			scope: tokens.scope ?? null,
			email,
		});

		const response = back("connected");
		response.cookies.delete(GOOGLE_STATE_COOKIE);
		return response;
	} catch (err) {
		logError(err instanceof Error ? err : new Error(String(err)), {
			source: "api/integrations/google/callback",
		});
		return back("error");
	}
}
