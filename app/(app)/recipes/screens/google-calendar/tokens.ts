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
