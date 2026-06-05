import zlib from "node:zlib";
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
// --- Minimal indexed-PNG encoder ------------------------------------------
// We encode the dithered indices against the EXACT palette ourselves instead
// of letting sharp's `.png({ palette: true })` re-quantize. libimagequant picks
// its own representative palette and merges/shifts colours (it collapsed
// color-6a green and blue into one teal), which corrupts a recipe's deliberate
// colour coding on the device. Writing the palette directly is lossless.

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

const crc32 = (buf: Buffer): number => {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData), 0);
	return Buffer.concat([length, typeAndData, crc]);
};

/** Smallest PNG indexed bit depth (1/2/4/8) that holds `numColors` entries. */
const indexedBitDepth = (numColors: number): number =>
	numColors <= 2 ? 1 : numColors <= 4 ? 2 : numColors <= 16 ? 4 : 8;

/**
 * Build an indexed (colour-type 3) PNG with an exact palette. `indices` is one
 * palette index per pixel (row-major); `palette` is the RGB lookup table.
 */
const buildIndexedPng = (
	width: number,
	height: number,
	indices: Uint8Array | number[],
	palette: [number, number, number][],
): Buffer => {
	const bitDepth = indexedBitDepth(palette.length);
	const pixelsPerByte = 8 / bitDepth;
	const rowBytes = Math.ceil(width / pixelsPerByte);
	const mask = (1 << bitDepth) - 1;

	// Scanlines: a leading filter byte (0 = None) then big-endian packed indices.
	const raw = Buffer.alloc((rowBytes + 1) * height);
	let pos = 0;
	for (let y = 0; y < height; y++) {
		raw[pos++] = 0;
		let acc = 0;
		let bits = 0;
		for (let x = 0; x < width; x++) {
			acc = (acc << bitDepth) | (indices[y * width + x] & mask);
			bits += bitDepth;
			if (bits === 8) {
				raw[pos++] = acc;
				acc = 0;
				bits = 0;
			}
		}
		if (bits > 0) raw[pos++] = acc << (8 - bits); // pad final byte, MSB-first
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.writeUInt8(bitDepth, 8);
	ihdr.writeUInt8(3, 9); // colour type 3 = indexed
	ihdr.writeUInt8(0, 10); // compression
	ihdr.writeUInt8(0, 11); // filter
	ihdr.writeUInt8(0, 12); // interlace

	const plte = Buffer.alloc(palette.length * 3);
	palette.forEach(([r, g, b], i) => {
		plte[i * 3] = r;
		plte[i * 3 + 1] = g;
		plte[i * 3 + 2] = b;
	});

	const idat = zlib.deflateSync(raw, { level: 9 });

	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", ihdr),
		pngChunk("PLTE", plte),
		pngChunk("IDAT", idat),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
};

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

	// Encode with the exact palette so every colour survives (no libimagequant
	// merge/shift). indices already reference the dithered palette entries.
	return buildIndexedPng(
		targetWidth,
		targetHeight,
		indices,
		hexPalette.map(hexToRgb),
	);
}

/** Render a recipe PNG to a dithered, device-ready PNG (see renderGrayscalePng). */
export async function renderPng(png: Buffer, options: RenderBmpOptions = {}) {
	if (options.palette && options.palette.length > 0) {
		return renderColorPng(png, options);
	}
	return renderGrayscalePng(png, options);
}
