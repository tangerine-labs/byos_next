import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";

// Paths that don't require authentication
const PUBLIC_PATHS = [
	"/api",
	"/_next",
	"/favicon.ico",
	"/sign-in",
	"/sign-up",
	"/recover",
];

/** Headless Chrome recipe capture (REACT_RENDERER=browser) — must not redirect to sign-in. */
const RECIPE_PREVIEW_PATH = /^\/recipes\/[^/]+\/preview\/?$/;

function isPublicPath(pathname: string): boolean {
	return (
		PUBLIC_PATHS.some((path) => pathname.startsWith(path)) ||
		RECIPE_PREVIEW_PATH.test(pathname)
	);
}

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Skip auth for public paths
	if (isPublicPath(pathname)) {
		return NextResponse.next();
	}

	// Skip auth check if authentication is disabled (mono-user mode)
	if (!auth) {
		return NextResponse.next();
	}

	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session) {
		return NextResponse.redirect(new URL("/sign-in", request.url));
	}

	return NextResponse.next();
}
