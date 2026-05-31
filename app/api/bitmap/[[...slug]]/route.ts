import type { NextRequest } from "next/server";
import { cache } from "react";
import NotFoundScreen from "@/app/(app)/recipes/screens/not-found/not-found";
import {
	type BitmapRenderOptions,
	parseBitmapQueryParams,
} from "@/lib/display/color-palette";
import {
	DEFAULT_IMAGE_HEIGHT,
	DEFAULT_IMAGE_WIDTH,
	logger,
	renderRecipeOutputs,
	renderRecipeToImage,
} from "@/lib/recipes/recipe-renderer";
import {
	parseRequestHeaders,
	resolveUserIdFromApiKey,
} from "../../display/utils";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const headers = parseRequestHeaders(req);
	try {
		// Always await params as required by Next.js 14/15
		const { slug = ["not-found"] } = await params;
		const bitmapPath = Array.isArray(slug) ? slug.join("/") : slug;
		// Device firmware fetches either `<screen>.bmp` or `<screen>.png`; the
		// display route picks the extension based on the device's image format.
		const imageFormat: "bmp" | "png" = bitmapPath.endsWith(".png")
			? "png"
			: "bmp";
		const recipeSlug = bitmapPath.replace(/\.(bmp|png)$/, "");

		// Get width, height, and grayscale from query parameters
		const { searchParams } = new URL(req.url);
		const widthParam = searchParams.get("width");
		const heightParam = searchParams.get("height");
		const bitmapRender = parseBitmapQueryParams(searchParams);

		const width = widthParam ? parseInt(widthParam, 10) : DEFAULT_IMAGE_WIDTH;
		const height = heightParam
			? parseInt(heightParam, 10)
			: DEFAULT_IMAGE_HEIGHT;

		// Validate width and height are positive numbers
		const validWidth = width > 0 ? width : DEFAULT_IMAGE_WIDTH;
		const validHeight = height > 0 ? height : DEFAULT_IMAGE_HEIGHT;

		const colorModeLabel = bitmapRender.palette
			? `${bitmapRender.palette.length}-color palette`
			: `${bitmapRender.grayscale ?? 2} gray levels`;
		logger.info(
			`Bitmap request for: ${bitmapPath} in ${validWidth}x${validHeight} with ${colorModeLabel}`,
		);

		// Resolve the device owner so DB queries are scoped to the right user.
		// TRMNL firmware typically does NOT send Access-Token when fetching the
		// bitmap URL it got from /api/display — accept it as a query param too,
		// matching the mixup bitmap route. Without this the lookup falls back to
		// shared-only (user_id IS NULL) and user-installed recipes vanish.
		const accessToken =
			headers.apiKey ?? searchParams.get("access_token") ?? null;
		const userId = accessToken
			? await resolveUserIdFromApiKey(accessToken)
			: null;

		// Forward cookies so browser rendering can reuse the caller's auth session.
		const cookieHeader = req.headers.get("cookie");

		const recipeBuffer = await renderRecipeDeviceImage(
			recipeSlug,
			validWidth,
			validHeight,
			bitmapRender,
			imageFormat,
			userId,
			cookieHeader || undefined,
		);

		if (
			!recipeBuffer ||
			!(recipeBuffer instanceof Buffer) ||
			recipeBuffer.length === 0
		) {
			logger.warn(
				`Failed to generate ${imageFormat} for ${recipeSlug}, returning fallback`,
			);
			return await renderFallback(
				"not-found",
				imageFormat,
				validWidth,
				validHeight,
			);
		}

		return new Response(new Uint8Array(recipeBuffer), {
			headers: {
				"Content-Type": imageFormat === "png" ? "image/png" : "image/bmp",
				"Content-Length": recipeBuffer.length.toString(),
			},
		});
	} catch (error) {
		logger.error("Error generating image:", error);

		// Instead of returning an error, return the NotFoundScreen as a fallback
		return await renderFallback(
			"not-found",
			"bmp",
			DEFAULT_IMAGE_WIDTH,
			DEFAULT_IMAGE_HEIGHT,
		);
	}
}

const renderRecipeDeviceImage = cache(
	async (
		recipeId: string,
		width: number,
		height: number,
		renderOptions: BitmapRenderOptions,
		format: "bmp" | "png",
		userId: string | null = null,
		cookies?: string,
	) => {
		const renders = await renderRecipeToImage({
			slug: recipeId,
			imageWidth: width,
			imageHeight: height,
			formats: [format === "png" ? "png-dithered" : "bitmap"],
			...renderOptions,
			userId,
			cookies,
		});
		const buffer = format === "png" ? renders.pngDithered : renders.bitmap;
		return buffer ?? Buffer.from([]);
	},
);

const renderFallback = cache(
	async (
		slug: string,
		format: "bmp" | "png",
		width: number,
		height: number,
	) => {
		try {
			const renders = await renderRecipeOutputs({
				slug,
				Component: NotFoundScreen,
				props: { slug },
				config: null,
				imageWidth: width,
				imageHeight: height,
				formats: [format === "png" ? "png-dithered" : "bitmap"],
				grayscale: format === "png" ? 16 : 2,
			});

			const buffer = format === "png" ? renders.pngDithered : renders.bitmap;
			if (!buffer) {
				throw new Error(`Missing ${format} buffer for fallback`);
			}

			return new Response(new Uint8Array(buffer), {
				headers: {
					"Content-Type": format === "png" ? "image/png" : "image/bmp",
					"Content-Length": buffer.length.toString(),
				},
			});
		} catch (fallbackError) {
			logger.error("Error generating fallback image:", fallbackError);
			return new Response("Error generating image", {
				status: 500,
				headers: {
					"Content-Type": "text/plain",
				},
			});
		}
	},
);
