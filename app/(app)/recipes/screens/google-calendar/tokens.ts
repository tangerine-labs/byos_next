/** Pure palette colors for TRMNL color-6a (no dithering on device). */
export const display6 = {
	red: "#FF0000",
	green: "#00FF00",
	blue: "#0000FF",
	yellow: "#FFFF00",
	black: "#000000",
	white: "#FFFFFF",
} as const;

/**
 * 50%-opacity fills for the month overview (over a white background). The idea
 * is that the server dither / device renders these as a lighter tint of the
 * pure palette colour rather than a vibrant solid block.
 */
export const display6Soft = {
	red: "rgba(255, 0, 0, 0.5)",
	green: "rgba(0, 255, 0, 0.5)",
} as const;

/**
 * Chess-style 50% black/white raster (8×8 tile, 4px squares) for "normal" month
 * days, so they read as a textured grey block — distinct from solid today/
 * weekend/holiday cells and from blank out-of-month cells. Pure black+white, so
 * it survives the palette dither untouched.
 */
export const CHESS_RASTER_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVR4nGNgYGD4j4zRAQMdFGDRgYpprwAAA4afYZpfiEEAAAAASUVORK5CYII=";

/**
 * Per-calendar event marker colours. red/green carry day-level meaning in the
 * month overview (holiday / weekend+vacation), so event dots are drawn from the
 * remaining legible accents first, cycling deterministically by calendar order.
 */
export const EVENT_ACCENTS = [
	display6.blue,
	display6.black,
	display6.red,
	display6.green,
] as const;

export function accentForIndex(index: number): string {
	return EVENT_ACCENTS[index % EVENT_ACCENTS.length];
}
