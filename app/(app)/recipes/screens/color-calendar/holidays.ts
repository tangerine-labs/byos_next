import Holidays from "date-holidays";
import type { HolidaysTypes } from "date-holidays";

export type HolidayInfo = { name: string };

/** ISO countries supported by the color calendar (extend as needed). */
export type HolidayCountry = "DK";

type CountryHolidayConfig = {
	/** date-holidays country code */
	code: string;
	languages: string[];
	/** observance rules to include (public holidays are always included) */
	includeObservanceRules: string[];
	/** rules to exclude regardless of type */
	excludeRules: string[];
};

const COUNTRY_CONFIG: Record<HolidayCountry, CountryHolidayConfig> = {
	DK: {
		code: "DK",
		languages: ["da"],
		includeObservanceRules: ["06-05", "12-24"],
		excludeRules: ["easter -48", "05-01", "2nd sunday in May"],
	},
};

const dateKey = (year: number, month: number, day: number): string =>
	`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const parseHolidayDate = (isoDate: string): { year: number; month: number; day: number } => {
	const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
	return { year, month, day };
};

const shouldInclude = (
	holiday: HolidaysTypes.Holiday,
	config: CountryHolidayConfig,
): boolean => {
	if (config.excludeRules.includes(holiday.rule)) return false;
	if (holiday.type === "public") return true;
	if (
		holiday.type === "observance" &&
		config.includeObservanceRules.includes(holiday.rule)
	) {
		return true;
	}
	return false;
};

const holidayClients = new Map<HolidayCountry, Holidays>();

function getHolidayClient(country: HolidayCountry): Holidays {
	let client = holidayClients.get(country);
	if (!client) {
		const config = COUNTRY_CONFIG[country];
		client = new Holidays(config.code);
		client.setLanguages(config.languages);
		holidayClients.set(country, client);
	}
	return client;
}

/** All holiday date keys for a calendar year in the given country. */
export function getHolidayMap(
	country: HolidayCountry,
	year: number,
): Map<string, HolidayInfo> {
	const config = COUNTRY_CONFIG[country];
	const map = new Map<string, HolidayInfo>();

	for (const holiday of getHolidayClient(country).getHolidays(year)) {
		if (!shouldInclude(holiday, config)) continue;
		const { year: y, month, day } = parseHolidayDate(holiday.date);
		map.set(dateKey(y, month, day), { name: holiday.name });
	}

	return map;
}

export function isHoliday(
	year: number,
	month: number,
	day: number,
	holidayMap: Map<string, HolidayInfo>,
): boolean {
	return holidayMap.has(dateKey(year, month, day));
}

export function getHolidayName(
	year: number,
	month: number,
	day: number,
	holidayMap: Map<string, HolidayInfo>,
): string | undefined {
	return holidayMap.get(dateKey(year, month, day))?.name;
}

/** @deprecated Use getHolidayMap("DK", year) */
export const getDanishHolidayMap = (year: number) => getHolidayMap("DK", year);

/** @deprecated Use isHoliday */
export const isDanishHoliday = isHoliday;
