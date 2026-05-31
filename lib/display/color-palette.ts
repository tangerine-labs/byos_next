/** TRMNL color-6a palette: red, green, blue, yellow, black, white */
export const COLOR_6A_PALETTE_ID = "color-6a";

export const COLOR_6A_HEX = [
	"#FF0000",
	"#00FF00",
	"#0000FF",
	"#FFFF00",
	"#000000",
	"#FFFFFF",
] as const;

export type Rgb = { r: number; g: number; b: number };

export function parseHexColor(hex: string): Rgb {
	const normalized = hex.replace("#", "").trim();
	const value =
		normalized.length === 3
			? normalized
					.split("")
					.map((c) => c + c)
					.join("")
			: normalized;
	const num = Number.parseInt(value, 16);
	return {
		r: (num >> 16) & 0xff,
		g: (num >> 8) & 0xff,
		b: num & 0xff,
	};
}

export function isColor6Palette(paletteId: string | null | undefined): boolean {
	return paletteId === COLOR_6A_PALETTE_ID;
}

export function resolvePaletteColors(
	paletteId: string | null | undefined,
): string[] | null {
	if (isColor6Palette(paletteId)) {
		return [...COLOR_6A_HEX];
	}
	return null;
}

export function getGrayscaleLevels(
	grayscale: number | null | undefined,
): number {
	if (grayscale === 2 || grayscale === 4 || grayscale === 16) {
		return grayscale;
	}
	return 2;
}

export type BitmapRenderParams = {
	width: number;
	height: number;
	grayscale: number | null | undefined;
	paletteId: string | null | undefined;
};

/** Query string for /api/bitmap URLs (preview + device firmware). */
export function buildBitmapQueryParams({
	width,
	height,
	grayscale,
	paletteId,
}: BitmapRenderParams): string {
	const parts = [`width=${width}`, `height=${height}`];
	if (isColor6Palette(paletteId)) {
		parts.push(`palette=${COLOR_6A_PALETTE_ID}`);
	} else {
		parts.push(`grayscale=${getGrayscaleLevels(grayscale)}`);
	}
	return parts.join("&");
}

export function getDisplayColorLabel(
	grayscale: number | null | undefined,
	paletteId: string | null | undefined,
): string {
	if (isColor6Palette(paletteId)) {
		return "6 colors";
	}
	return `${getGrayscaleLevels(grayscale)} levels`;
}

export type BitmapRenderOptions = {
	grayscale?: number;
	palette?: string[];
};

/** Parse `grayscale` / `palette` query params for bitmap routes. */
export function parseBitmapQueryParams(
	searchParams: URLSearchParams,
): BitmapRenderOptions {
	const paletteParam = searchParams.get("palette");
	if (paletteParam === COLOR_6A_PALETTE_ID) {
		return { palette: [...COLOR_6A_HEX] };
	}
	const grayscaleParam = searchParams.get("grayscale");
	return {
		grayscale: grayscaleParam ? Number.parseInt(grayscaleParam, 10) : 2,
	};
}

export function bitmapOptionsFromDevice(device: {
	grayscale: number | null | undefined;
	palette_id: string | null | undefined;
}): BitmapRenderOptions {
	const palette = resolvePaletteColors(device.palette_id);
	if (palette) {
		return { palette };
	}
	return { grayscale: getGrayscaleLevels(device.grayscale) };
}

/**
 * Approximate byte size of the indexed BMP we'd render for these options.
 * Mirrors utils/render-bmp.ts buildIndexedBmpBuffer: 14-byte file header +
 * 40-byte info header + palette (4 bytes/entry) + 4-byte-aligned pixel rows.
 */
export function estimateBmpBytes(
	width: number,
	height: number,
	options: BitmapRenderOptions,
): number {
	const colors = options.palette
		? options.palette.length
		: getGrayscaleLevels(options.grayscale);
	const bitsPerPixel = colors <= 2 ? 1 : colors <= 4 ? 2 : 4;
	const rowSize = Math.floor((width * bitsPerPixel + 31) / 32) * 4;
	return 14 + 40 + colors * 4 + rowSize * height;
}

/**
 * Largest BMP we'll hand a device before switching to PNG. TRMNL panels declare
 * a ~90KB image_size_limit; raw BMPs above that overflow the firmware's receive
 * buffer ("file size too big"), while the equivalent PNG compresses under it.
 * The standard 800×480 1-bit BMP is ~48KB, so OG/Xiao devices stay on BMP and
 * only high-resolution panels (e.g. TRMNL X, 1872×1404) switch to PNG.
 */
export const DEVICE_BMP_MAX_BYTES = 96_000;

/** Pick the device image format: BMP unless the raw BMP would be too large. */
export function deviceImageFormat(
	width: number,
	height: number,
	options: BitmapRenderOptions,
): "bmp" | "png" {
	return estimateBmpBytes(width, height, options) > DEVICE_BMP_MAX_BYTES
		? "png"
		: "bmp";
}
