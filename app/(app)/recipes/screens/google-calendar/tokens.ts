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
 * Per-calendar event marker colours. Deliberately excludes blue: the color-6a
 * PNG path can only carry 4 distinct colours without merging, so the recipe is
 * kept to {white, black, red, green} to stop green collapsing into blue on the
 * device. red/green also carry day meaning in the month grid, but in the event
 * list a coloured bar reads clearly as a per-calendar marker.
 */
export const EVENT_ACCENTS = [
	display6.black,
	display6.red,
	display6.green,
] as const;

export function accentForIndex(index: number): string {
	return EVENT_ACCENTS[index % EVENT_ACCENTS.length];
}
