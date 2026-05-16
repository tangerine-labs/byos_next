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
