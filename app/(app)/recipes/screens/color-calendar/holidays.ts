import Holidays from "date-holidays";
import type { HolidaysTypes } from "date-holidays";

export type HolidayCountry = "DK";

const CONFIG: Record<
	HolidayCountry,
	{ languages: string[]; extraObservance: Set<string>; exclude: Set<string> }
> = {
	DK: {
		languages: ["da"],
		extraObservance: new Set(["06-05", "12-24"]),
		exclude: new Set(["easter -48", "05-01", "2nd sunday in May"]),
	},
};

const clients = new Map<HolidayCountry, Holidays>();

function getClient(country: HolidayCountry): Holidays {
	let hd = clients.get(country);
	if (!hd) {
		hd = new Holidays(country);
		hd.setLanguages(CONFIG[country].languages);
		clients.set(country, hd);
	}
	return hd;
}

function isIncluded(country: HolidayCountry, h: HolidaysTypes.Holiday): boolean {
	const { exclude, extraObservance } = CONFIG[country];
	if (exclude.has(h.rule)) return false;
	return (
		h.type === "public" ||
		(h.type === "observance" && extraObservance.has(h.rule))
	);
}

/** ISO dates (YYYY-MM-DD) to highlight as holidays. */
export function getHolidayDates(
	country: HolidayCountry,
	year: number,
): ReadonlySet<string> {
	const dates = new Set<string>();
	for (const h of getClient(country).getHolidays(year)) {
		if (isIncluded(country, h)) dates.add(h.date.slice(0, 10));
	}
	return dates;
}
