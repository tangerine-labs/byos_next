import sharp from "sharp";
import {
	applyColorDithering,
	applyDithering,
	DitheringMethod,
	parseHexPalette,
} from "./image-processing";

export { DitheringMethod };

export interface RenderBmpOptions {
	ditheringMethod?: DitheringMethod;
	inverted?: boolean;
	width?: number;
	height?: number;
	grayscale?: number; // Number of gray levels: 2 (black/white), 4, or 16
	/** Hex colors for discrete-color screens (e.g. 6-color e-ink). */
	palette?: string[];
	applyEdgeSnap?: boolean;
}

const GRAYSCALE_LEVELS = [2, 4, 16] as const;

const createGrayscalePaletteEntries = (grayscale: number): number[] => {
	const paletteStep = 255 / (grayscale - 1);

	return Array.from({ length: grayscale }, (_, index) => {
		const grayValue = Math.round(index * paletteStep);
		return (grayValue << 16) | (grayValue << 8) | grayValue;
	});
};

const createColorPaletteEntries = (hexColors: string[]): number[] =>
	hexColors.map((hex) => {
		const normalized = hex.replace("#", "").trim();
		const num = Number.parseInt(normalized, 16);
		const r = (num >> 16) & 0xff;
		const g = (num >> 8) & 0xff;
		const b = num & 0xff;
		return (r << 16) | (g << 8) | b;
	});

const mapGrayscaleValueToPaletteIndex = (
	value: number,
	grayscale: number,
): number => {
	const paletteStep = 255 / (grayscale - 1);
	return Math.round(value / paletteStep);
};

const shouldSetMonochromeBit = (
	paletteIndex: number,
	grayscale: number,
): boolean => paletteIndex === grayscale - 1;

const writeBmpIndexedRows = ({
	buffer,
	dataOffset,
	rowSize,
	targetWidth,
	targetHeight,
	bitsPerPixel,
	indices,
	numColors,
	inverted,
}: {
	buffer: Buffer;
	dataOffset: number;
	rowSize: number;
	targetWidth: number;
	targetHeight: number;
	bitsPerPixel: 1 | 2 | 4;
	indices: Uint8Array;
	numColors: number;
	inverted: boolean;
}) => {
	for (let y = 0; y < targetHeight; y++) {
		const targetY = targetHeight - 1 - y;
		const yOffset = targetY * targetWidth;
		const destRowOffset = dataOffset + y * rowSize;

		if (bitsPerPixel === 1) {
			for (let x = 0; x < targetWidth; x += 8) {
				let byte = 0;
				const remainingPixels = Math.min(8, targetWidth - x);
				for (let bit = 0; bit < remainingPixels; bit++) {
					const idx = yOffset + x + bit;
					let paletteIndex = indices[idx];
					if (inverted) paletteIndex = numColors - 1 - paletteIndex;
					if (shouldSetMonochromeBit(paletteIndex, numColors)) {
						byte |= 1 << (7 - bit);
					}
				}
				buffer[destRowOffset + (x >> 3)] = byte;
			}
		} else if (bitsPerPixel === 2) {
			for (let x = 0; x < targetWidth; x += 4) {
				let byte = 0;
				const remainingPixels = Math.min(4, targetWidth - x);
				for (let bit = 0; bit < remainingPixels; bit++) {
					const idx = yOffset + x + bit;
					let paletteIndex = indices[idx];
					if (inverted) paletteIndex = numColors - 1 - paletteIndex;
					byte |= paletteIndex << (6 - bit * 2);
				}
				buffer[destRowOffset + (x >> 2)] = byte;
			}
		} else {
			for (let x = 0; x < targetWidth; x += 2) {
				let byte = 0;
				const remainingPixels = Math.min(2, targetWidth - x);
				for (let bit = 0; bit < remainingPixels; bit++) {
					const idx = yOffset + x + bit;
					let paletteIndex = indices[idx];
					if (inverted) paletteIndex = numColors - 1 - paletteIndex;
					byte |= paletteIndex << (4 - bit * 4);
				}
				buffer[destRowOffset + (x >> 1)] = byte;
			}
		}
	}
};

async function loadAndResizePng(
	png: Buffer,
	targetWidth: number,
	targetHeight: number,
) {
	const metadata = await sharp(png).metadata();
	const isDoubleSize =
		metadata.width === targetWidth * 2 && metadata.height === targetHeight * 2;

	let image = sharp(png);
	if (isDoubleSize) {
		image = image.resize(targetWidth, targetHeight, {
			kernel: sharp.kernel.nearest,
		});
	}
	return image;
}

function buildIndexedBmpBuffer({
	targetWidth,
	targetHeight,
	bitsPerPixel,
	numColors,
	paletteEntries,
	indices,
	inverted,
}: {
	targetWidth: number;
	targetHeight: number;
	bitsPerPixel: 1 | 2 | 4;
	numColors: number;
	paletteEntries: number[];
	indices: Uint8Array;
	inverted: boolean;
}): Buffer {
	const paletteSize = numColors * 4;
	const fileHeaderSize = 14;
	const infoHeaderSize = 40;
	const rowSize = Math.floor((targetWidth * bitsPerPixel + 31) / 32) * 4;
	const headerSize = fileHeaderSize + infoHeaderSize + paletteSize;
	const fileSize = headerSize + rowSize * targetHeight;
	const buffer = Buffer.alloc(fileSize);

	buffer.write("BM", 0);
	buffer.writeUInt32LE(fileSize, 2);
	buffer.writeUInt32LE(0, 6);
	buffer.writeUInt32LE(fileHeaderSize + infoHeaderSize + paletteSize, 10);

	buffer.writeUInt32LE(infoHeaderSize, 14);
	buffer.writeInt32LE(targetWidth, 18);
	buffer.writeInt32LE(targetHeight, 22);
	buffer.writeUInt16LE(1, 26);
	buffer.writeUInt16LE(bitsPerPixel, 28);
	buffer.writeUInt32LE(0, 30);
	buffer.writeUInt32LE(rowSize * targetHeight, 34);
	buffer.writeInt32LE(0, 38);
	buffer.writeInt32LE(0, 42);
	buffer.writeUInt32LE(numColors, 46);
	buffer.writeUInt32LE(numColors, 50);

	const paletteOffset = fileHeaderSize + infoHeaderSize;
	for (const [index, paletteEntry] of paletteEntries.entries()) {
		buffer.writeUInt32LE(paletteEntry, paletteOffset + index * 4);
	}

	const dataOffset = fileHeaderSize + infoHeaderSize + paletteSize;
	writeBmpIndexedRows({
		buffer,
		dataOffset,
		rowSize,
		targetWidth,
		targetHeight,
		bitsPerPixel,
		indices,
		numColors,
		inverted,
	});

	return buffer;
}

async function renderColorBmp(
	png: Buffer,
	options: RenderBmpOptions,
): Promise<Buffer> {
	const {
		ditheringMethod = DitheringMethod.FLOYD_STEINBERG,
		inverted = false,
		palette: hexPalette = [],
	} = options;

	if (hexPalette.length < 2) {
		throw new Error("Color palette must include at least 2 colors");
	}

	const targetWidth = options.width ?? 800;
	const targetHeight = options.height ?? 480;
	const targetPixelCount = targetWidth * targetHeight;

	const image = await loadAndResizePng(png, targetWidth, targetHeight);
	const rgbImage = await image.removeAlpha().raw().toBuffer({
		resolveWithObject: true,
	});

	const rgbData = new Uint8Array(targetPixelCount * 3);
	for (let i = 0; i < targetPixelCount * 3; i++) {
		rgbData[i] = rgbImage.data[i] as number;
	}

	const colorPalette = parseHexPalette(hexPalette);
	const indices = applyColorDithering(ditheringMethod, rgbData, {
		width: targetWidth,
		height: targetHeight,
		palette: colorPalette,
	});

	const numColors = hexPalette.length;
	const bitsPerPixel: 1 | 2 | 4 = numColors <= 2 ? 1 : numColors <= 4 ? 2 : 4;

	return buildIndexedBmpBuffer({
		targetWidth,
		targetHeight,
		bitsPerPixel,
		numColors,
		paletteEntries: createColorPaletteEntries(hexPalette),
		indices,
		inverted,
	});
}

async function renderGrayscaleBmp(
	png: Buffer,
	options: RenderBmpOptions,
): Promise<Buffer> {
	const {
		ditheringMethod = DitheringMethod.FLOYD_STEINBERG,
		inverted = false,
		grayscale = 2,
		applyEdgeSnap = true,
	} = options;

	if (
		!GRAYSCALE_LEVELS.includes(grayscale as (typeof GRAYSCALE_LEVELS)[number])
	) {
		throw new Error(
			`Invalid grayscale value: ${grayscale}. Must be one of: ${GRAYSCALE_LEVELS.join(", ")}`,
		);
	}

	const targetWidth = options.width ?? 800;
	const targetHeight = options.height ?? 480;
	const targetPixelCount = targetWidth * targetHeight;

	const image = await loadAndResizePng(png, targetWidth, targetHeight);
	const grayscaleImage = await image.grayscale().raw().toBuffer({
		resolveWithObject: true,
	});

	const grayscaleData = new Uint8Array(targetPixelCount);
	for (let i = 0; i < targetPixelCount; i++) {
		grayscaleData[i] = grayscaleImage.data[i] as number;
	}

	const dithered = applyDithering(ditheringMethod, grayscaleData, {
		width: targetWidth,
		height: targetHeight,
		levels: grayscale,
		applyEdgeSnap,
	});

	const bitsPerPixel: 1 | 2 | 4 = grayscale === 2 ? 1 : grayscale === 4 ? 2 : 4;
	const indices = new Uint8Array(targetPixelCount);
	const valueToIndex = (value: number): number =>
		mapGrayscaleValueToPaletteIndex(value, grayscale);
	for (let i = 0; i < targetPixelCount; i++) {
		indices[i] = valueToIndex(dithered[i]);
	}

	return buildIndexedBmpBuffer({
		targetWidth,
		targetHeight,
		bitsPerPixel,
		numColors: grayscale,
		paletteEntries: createGrayscalePaletteEntries(grayscale),
		indices,
		inverted,
	});
}

export async function renderBmp(png: Buffer, options: RenderBmpOptions = {}) {
	if (options.palette && options.palette.length > 0) {
		return renderColorBmp(png, options);
	}
	return renderGrayscaleBmp(png, options);
}

const hexToRgb = (hex: string): [number, number, number] => {
	const num = Number.parseInt(hex.replace("#", "").trim(), 16);
	return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
};

/**
 * Same dithering pipeline as renderGrayscaleBmp, but encodes the dithered
 * pixels as a compressed (indexed) PNG instead of a raw BMP. Used for device
 * models whose firmware accepts PNG (e.g. the TRMNL X, 1872×1404): a raw BMP at
 * their native resolution far exceeds the firmware's image-size limit, while the
 * equivalent dithered PNG compresses well under it. The on-device pixels are
 * identical to what the BMP path would produce.
 */
async function renderGrayscalePng(
	png: Buffer,
	options: RenderBmpOptions,
): Promise<Buffer> {
	const {
		ditheringMethod = DitheringMethod.FLOYD_STEINBERG,
		inverted = false,
		grayscale = 2,
		applyEdgeSnap = true,
	} = options;

	if (
		!GRAYSCALE_LEVELS.includes(grayscale as (typeof GRAYSCALE_LEVELS)[number])
	) {
		throw new Error(
			`Invalid grayscale value: ${grayscale}. Must be one of: ${GRAYSCALE_LEVELS.join(", ")}`,
		);
	}

	const targetWidth = options.width ?? 800;
	const targetHeight = options.height ?? 480;
	const targetPixelCount = targetWidth * targetHeight;

	const image = await loadAndResizePng(png, targetWidth, targetHeight);
	const grayscaleImage = await image.grayscale().raw().toBuffer({
		resolveWithObject: true,
	});

	const grayscaleData = new Uint8Array(targetPixelCount);
	for (let i = 0; i < targetPixelCount; i++) {
		grayscaleData[i] = grayscaleImage.data[i] as number;
	}

	const dithered = applyDithering(ditheringMethod, grayscaleData, {
		width: targetWidth,
		height: targetHeight,
		levels: grayscale,
		applyEdgeSnap,
	});

	const gray = Buffer.alloc(targetPixelCount);
	for (let i = 0; i < targetPixelCount; i++) {
		gray[i] = inverted ? 255 - dithered[i] : dithered[i];
	}

	return sharp(gray, {
		raw: { width: targetWidth, height: targetHeight, channels: 1 },
	})
		.png({ compressionLevel: 9, palette: true, colours: grayscale })
		.toBuffer();
}

/** Color-palette analogue of renderGrayscalePng. */
async function renderColorPng(
	png: Buffer,
	options: RenderBmpOptions,
): Promise<Buffer> {
	const {
		ditheringMethod = DitheringMethod.FLOYD_STEINBERG,
		palette: hexPalette = [],
	} = options;

	if (hexPalette.length < 2) {
		throw new Error("Color palette must include at least 2 colors");
	}

	const targetWidth = options.width ?? 800;
	const targetHeight = options.height ?? 480;
	const targetPixelCount = targetWidth * targetHeight;

	const image = await loadAndResizePng(png, targetWidth, targetHeight);
	const rgbImage = await image.removeAlpha().raw().toBuffer({
		resolveWithObject: true,
	});

	const rgbData = new Uint8Array(targetPixelCount * 3);
	for (let i = 0; i < targetPixelCount * 3; i++) {
		rgbData[i] = rgbImage.data[i] as number;
	}

	const colorPalette = parseHexPalette(hexPalette);
	const indices = applyColorDithering(ditheringMethod, rgbData, {
		width: targetWidth,
		height: targetHeight,
		palette: colorPalette,
	});

	const rgbTriplets = hexPalette.map(hexToRgb);
	const out = Buffer.alloc(targetPixelCount * 3);
	for (let i = 0; i < targetPixelCount; i++) {
		const [r, g, b] = rgbTriplets[indices[i]] ?? [0, 0, 0];
		out[i * 3] = r;
		out[i * 3 + 1] = g;
		out[i * 3 + 2] = b;
	}

	return sharp(out, {
		raw: { width: targetWidth, height: targetHeight, channels: 3 },
	})
		.png({ compressionLevel: 9, palette: true, colours: hexPalette.length })
		.toBuffer();
}

/** Render a recipe PNG to a dithered, device-ready PNG (see renderGrayscalePng). */
export async function renderPng(png: Buffer, options: RenderBmpOptions = {}) {
	if (options.palette && options.palette.length > 0) {
		return renderColorPng(png, options);
	}
	return renderGrayscalePng(png, options);
}
