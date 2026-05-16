import type { Rgb } from "@/lib/display/color-palette";
import { parseHexColor } from "@/lib/display/color-palette";

export type ColorPalette = Rgb[];

const colorDistanceSq = (
	r: number,
	g: number,
	b: number,
	color: Rgb,
): number => {
	const dr = r - color.r;
	const dg = g - color.g;
	const db = b - color.b;
	return dr * dr + dg * dg + db * db;
};

/** Index of the nearest palette color (squared RGB distance). */
export const findNearestPaletteIndex = (
	r: number,
	g: number,
	b: number,
	palette: ColorPalette,
): number => {
	let bestIndex = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < palette.length; i++) {
		const dist = colorDistanceSq(r, g, b, palette[i]);
		if (dist < bestDist) {
			bestDist = dist;
			bestIndex = i;
		}
	}
	return bestIndex;
};

export function parseHexPalette(hexColors: string[]): ColorPalette {
	return hexColors.map(parseHexColor);
}

/** Quantize a single pixel value to the nearest available gray level
 *  e.g. levels=2 → 0 or 255, levels=4 → 0, 85, 170, 256
 **/
export const quantizeValue = (value: number, levels: number): number => {
	const step = 255 / (levels - 1);
	const quantized = Math.round(value / step) * step;
	return Math.min(255, Math.max(0, quantized));
};

/** Quantize each pixel to the nearest gray level with no dithering */
export const quantize = (grayscale: Uint8Array, levels = 2): Uint8Array => {
	const result = new Uint8Array(grayscale.length);
	for (let i = 0; i < grayscale.length; i++) {
		result[i] = quantizeValue(grayscale[i], levels);
	}
	return result;
};

/** Simple threshold dithering. Pixels below threshold map to black, at or above to white. */
export const ditherThreshold = (
	grayscale: Uint8Array,
	threshold = 128,
): Uint8Array => {
	const result = new Uint8Array(grayscale.length);
	for (let i = 0; i < grayscale.length; i++) {
		result[i] = grayscale[i] < threshold ? 0 : 255;
	}
	return result;
};

/** Floyd-Steinberg error diffusion dithering */
export const ditherFloydSteinberg = (
	grayscale: Uint8Array,
	width: number,
	height: number,
	levels = 2,
): Uint8Array => {
	const result = new Uint8Array(grayscale.length);
	const buffer = new Float32Array(grayscale.length);

	for (let i = 0; i < grayscale.length; i++) {
		buffer[i] = grayscale[i];
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			const oldPixel = buffer[index];
			const newPixel = quantizeValue(oldPixel, levels);
			result[index] = newPixel;
			const error = oldPixel - newPixel;

			if (x + 1 < width) buffer[index + 1] += (error * 7) / 16;
			if (y + 1 < height && x > 0)
				buffer[index + width - 1] += (error * 3) / 16;
			if (y + 1 < height) buffer[index + width] += (error * 5) / 16;
			if (y + 1 < height && x + 1 < width)
				buffer[index + width + 1] += (error * 1) / 16;
		}
	}

	return result;
};

/** Atkinson error diffusion dithering */
export const ditherAtkinson = (
	grayscale: Uint8Array,
	width: number,
	height: number,
	levels = 2,
): Uint8Array => {
	const result = new Uint8Array(grayscale.length);
	const buffer = new Float32Array(grayscale.length);

	for (let i = 0; i < grayscale.length; i++) {
		buffer[i] = grayscale[i];
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			const oldPixel = buffer[index];
			const newPixel = quantizeValue(oldPixel, levels);
			result[index] = newPixel;
			const error = Math.floor((oldPixel - newPixel) / 8);

			if (x + 1 < width) buffer[index + 1] += error;
			if (x + 2 < width) buffer[index + 2] += error;
			if (y + 1 < height && x - 1 >= 0) buffer[index + width - 1] += error;
			if (y + 1 < height) buffer[index + width] += error;
			if (y + 1 < height && x + 1 < width) buffer[index + width + 1] += error;
			if (y + 2 < height) buffer[index + width * 2] += error;
		}
	}

	return result;
};

/** Floyd–Steinberg dithering into a fixed RGB palette (returns palette indices). */
export const ditherFloydSteinbergColor = (
	rgb: Uint8Array,
	width: number,
	height: number,
	palette: ColorPalette,
): Uint8Array => {
	const result = new Uint8Array(width * height);
	const rBuf = new Float32Array(width * height);
	const gBuf = new Float32Array(width * height);
	const bBuf = new Float32Array(width * height);

	for (let i = 0; i < width * height; i++) {
		const o = i * 3;
		rBuf[i] = rgb[o];
		gBuf[i] = rgb[o + 1];
		bBuf[i] = rgb[o + 2];
	}

	const diffuse = (
		index: number,
		dr: number,
		dg: number,
		db: number,
		factor: number,
	) => {
		if (index < 0 || index >= width * height) return;
		rBuf[index] += (dr * factor) / 16;
		gBuf[index] += (dg * factor) / 16;
		bBuf[index] += (db * factor) / 16;
	};

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			const oldR = rBuf[index];
			const oldG = gBuf[index];
			const oldB = bBuf[index];
			const paletteIndex = findNearestPaletteIndex(oldR, oldG, oldB, palette);
			const chosen = palette[paletteIndex];
			result[index] = paletteIndex;

			const errR = oldR - chosen.r;
			const errG = oldG - chosen.g;
			const errB = oldB - chosen.b;

			if (x + 1 < width) diffuse(index + 1, errR, errG, errB, 7);
			if (y + 1 < height && x > 0)
				diffuse(index + width - 1, errR, errG, errB, 3);
			if (y + 1 < height) diffuse(index + width, errR, errG, errB, 5);
			if (y + 1 < height && x + 1 < width)
				diffuse(index + width + 1, errR, errG, errB, 1);
		}
	}

	return result;
};

const BAYER_MATRICES = {
	2: [
		[0, 2],
		[3, 1],
	],
	4: [
		[0, 8, 2, 10],
		[12, 4, 14, 6],
		[3, 11, 1, 9],
		[15, 7, 13, 5],
	],
	8: [
		[0, 32, 8, 40, 2, 34, 10, 42],
		[48, 16, 56, 24, 50, 18, 58, 26],
		[12, 44, 4, 36, 14, 46, 6, 38],
		[60, 28, 52, 20, 62, 30, 54, 22],
		[3, 35, 11, 43, 1, 33, 9, 41],
		[51, 19, 59, 27, 49, 17, 57, 25],
		[15, 47, 7, 39, 13, 45, 5, 37],
		[63, 31, 55, 23, 61, 29, 53, 21],
	],
};

/** Bayer ordered dithering. patternSize selects the matrix: 2, 4, or 8 */
export const ditherBayer = (
	grayscale: Uint8Array,
	width: number,
	height: number,
	levels = 2,
	patternSize = 8,
): Uint8Array => {
	const result = new Uint8Array(grayscale.length);

	const matrixSize = patternSize <= 2 ? 2 : patternSize <= 4 ? 4 : 8;
	const matrix = BAYER_MATRICES[matrixSize];
	const matrixLength = matrix.length;

	const normalizedMatrix = matrix.map((row) =>
		row.map((val) => Math.floor((val * 255) / (matrixLength * matrixLength))),
	);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			const gray = grayscale[index];
			const threshold = normalizedMatrix[y % matrixLength][x % matrixLength];
			const adjustedValue = gray + (threshold - 128);
			result[index] = quantizeValue(adjustedValue, levels);
		}
	}

	return result;
};

/** Random noise dithering */
export const ditherRandom = (grayscale: Uint8Array, levels = 2): Uint8Array => {
	const result = new Uint8Array(grayscale.length);

	for (let i = 0; i < grayscale.length; i++) {
		const adjustedValue = grayscale[i] + (Math.random() * 255 - 128);
		result[i] = quantizeValue(adjustedValue, levels);
	}

	return result;
};

/** Detect edge pixels by checking if a pixel or any 4-directional neighbor is near pure black or white.
 *  Returns a Uint8Array where 1 = edge pixel, 0 = non-edge. Border pixels are always 0. */
export const detectEdges = (
	grayscale: Uint8Array,
	width: number,
	height: number,
	fuzziness = 20,
): Uint8Array => {
	const result = new Uint8Array(grayscale.length);
	const limit = 255 - fuzziness;

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const idx = y * width + x;
			const isExtreme = (v: number) => v < fuzziness || v > limit;
			const hasExtreme =
				isExtreme(grayscale[idx]) ||
				isExtreme(grayscale[idx - 1]) ||
				isExtreme(grayscale[idx + 1]) ||
				isExtreme(grayscale[idx - width]) ||
				isExtreme(grayscale[idx + width]);
			result[idx] = hasExtreme ? 1 : 0;
		}
	}

	return result;
};

/** For edge pixels, snap to the nearest quantized level instead of using the dithered value.
 *  Non-edge pixels pass through unchanged from the dithered input. */
export const applyEdgeSnap = (
	grayscale: Uint8Array,
	dithered: Uint8Array,
	edges: Uint8Array,
	levels = 2,
): Uint8Array => {
	const result = new Uint8Array(grayscale.length);
	for (let i = 0; i < grayscale.length; i++) {
		result[i] = edges[i] ? quantizeValue(grayscale[i], levels) : dithered[i];
	}
	return result;
};

export enum DitheringMethod {
	THRESHOLD = "threshold",
	FLOYD_STEINBERG = "floyd-steinberg",
	ATKINSON = "atkinson",
	BAYER = "bayer",
	RANDOM = "random",
	NONE = "none",
}

export interface DitheringOptions {
	width?: number;
	height?: number;
	levels?: number;
	threshold?: number;
	applyEdgeSnap?: boolean;
	edgeDetectionFuzziness?: number;
	bayerPatternSize?: 2 | 4 | 8;
}

export interface ColorDitheringOptions {
	width: number;
	height: number;
	palette: ColorPalette;
}

export function applyDithering(
	method: DitheringMethod,
	grayscale: Uint8Array,
	options: DitheringOptions = {},
): Uint8Array {
	const {
		width,
		height,
		levels,
		threshold,
		applyEdgeSnap: edgeSnap = false,
		edgeDetectionFuzziness,
		bayerPatternSize,
	} = options;

	const needsDimensions =
		method === DitheringMethod.FLOYD_STEINBERG ||
		method === DitheringMethod.ATKINSON ||
		method === DitheringMethod.BAYER ||
		edgeSnap;

	if (needsDimensions && (width === undefined || height === undefined)) {
		throw new Error(`width and height are required for ${method} dithering`);
	}
	if (bayerPatternSize !== undefined && ![2, 4, 8].includes(bayerPatternSize)) {
		throw new Error("bayerPatternSize must be 2, 4, or 8");
	}

	const requireDimensions = (): [number, number] => {
		if (width === undefined || height === undefined) {
			throw new Error(`width and height are required for ${method} dithering`);
		}

		return [width, height];
	};

	let result: Uint8Array;
	switch (method) {
		case DitheringMethod.THRESHOLD:
			result = ditherThreshold(grayscale, threshold);
			break;
		case DitheringMethod.FLOYD_STEINBERG: {
			const [resolvedWidth, resolvedHeight] = requireDimensions();
			result = ditherFloydSteinberg(
				grayscale,
				resolvedWidth,
				resolvedHeight,
				levels,
			);
			break;
		}
		case DitheringMethod.ATKINSON: {
			const [resolvedWidth, resolvedHeight] = requireDimensions();
			result = ditherAtkinson(grayscale, resolvedWidth, resolvedHeight, levels);
			break;
		}
		case DitheringMethod.BAYER: {
			const [resolvedWidth, resolvedHeight] = requireDimensions();
			result = ditherBayer(
				grayscale,
				resolvedWidth,
				resolvedHeight,
				levels,
				bayerPatternSize,
			);
			break;
		}
		case DitheringMethod.RANDOM:
			result = ditherRandom(grayscale, levels);
			break;
		case DitheringMethod.NONE:
			result = quantize(grayscale, levels);
			break;
	}

	if (edgeSnap) {
		const [resolvedWidth, resolvedHeight] = requireDimensions();
		const edges = detectEdges(
			grayscale,
			resolvedWidth,
			resolvedHeight,
			edgeDetectionFuzziness,
		);
		return applyEdgeSnap(grayscale, result, edges, levels);
	}

	return result;
}

export function applyColorDithering(
	method: DitheringMethod,
	rgb: Uint8Array,
	options: ColorDitheringOptions,
): Uint8Array {
	const { width, height, palette } = options;

	if (palette.length < 2) {
		throw new Error("Color palette must have at least 2 colors");
	}

	switch (method) {
		case DitheringMethod.FLOYD_STEINBERG:
			return ditherFloydSteinbergColor(rgb, width, height, palette);
		case DitheringMethod.NONE: {
			const result = new Uint8Array(width * height);
			for (let i = 0; i < width * height; i++) {
				const o = i * 3;
				result[i] = findNearestPaletteIndex(
					rgb[o],
					rgb[o + 1],
					rgb[o + 2],
					palette,
				);
			}
			return result;
		}
		default:
			return ditherFloydSteinbergColor(rgb, width, height, palette);
	}
}
