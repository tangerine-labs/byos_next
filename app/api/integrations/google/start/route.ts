import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
	buildAuthUrl,
	GOOGLE_STATE_COOKIE,
	googleCallbackUrl,
	isGoogleOAuthConfigured,
	originFromHeaders,
} from "@/lib/integrations/google-calendar";

const RETURN_PATH = "/recipes/google-calendar";

export async function GET(request: NextRequest) {
	const origin = originFromHeaders(request.headers);

	if (!isGoogleOAuthConfigured()) {
		return NextResponse.redirect(
			`${origin}${RETURN_PATH}?google=not_configured`,
		);
	}

	const state = crypto.randomUUID();
	const authUrl = buildAuthUrl(googleCallbackUrl(origin), state);

	const response = NextResponse.redirect(authUrl);
	// Lax so the cookie survives the top-level redirect back from Google.
	response.cookies.set(GOOGLE_STATE_COOKIE, state, {
		httpOnly: true,
		sameSite: "lax",
		secure: origin.startsWith("https://"),
		path: "/",
		maxAge: 600,
	});
	return response;
}
