import { Temporal } from "@/lib/temporal";

/** Danish public holidays and commonly marked days (Europe/Copenhagen calendar). */

export type HolidayInfo = { name: string };

const dateKey = (year: number, month: number, day: number): string =>
	`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Anonymous Gregorian algorithm — returns Easter Sunday (local date parts). */
function easterSunday(year: number): { month: number; day: number } {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return { month, day };
}

function addDays(
	year: number,
	month: number,
	day: number,
	offset: number,
): { year: number; month: number; day: number } {
	const date = Temporal.PlainDate.from({ year, month, day }).add({
		days: offset,
	});
	return { year: date.year, month: date.month, day: date.day };
}

/** All Danish holiday date keys for a calendar year. */
export function getDanishHolidayMap(year: number): Map<string, HolidayInfo> {
	const map = new Map<string, HolidayInfo>();

	const add = (y: number, m: number, d: number, name: string) => {
		map.set(dateKey(y, m, d), { name });
	};

	add(year, 1, 1, "Nytårsdag");
	add(year, 6, 5, "Grundlovsdag");
	add(year, 12, 24, "Juleaften");
	add(year, 12, 25, "Juledag");
	add(year, 12, 26, "2. juledag");

	const easter = easterSunday(year);
	const e = { year, month: easter.month, day: easter.day };

	const movable: { offset: number; name: string }[] = [
		{ offset: -3, name: "Skærtorsdag" },
		{ offset: -2, name: "Langfredag" },
		{ offset: 0, name: "Påskedag" },
		{ offset: 1, name: "2. påskedag" },
		{ offset: 39, name: "Kr. himmelfartsdag" },
		{ offset: 49, name: "Pinsedag" },
		{ offset: 50, name: "2. pinsedag" },
	];

	for (const { offset, name } of movable) {
		const {
			year: y,
			month: m,
			day: d,
		} = addDays(e.year, e.month, e.day, offset);
		add(y, m, d, name);
	}

	// Store Bededag (abolished from 2024) — 26 days after Easter Sunday
	if (year < 2024) {
		const bededag = addDays(e.year, e.month, e.day, 26);
		add(bededag.year, bededag.month, bededag.day, "Store bededag");
	}

	return map;
}

export function isDanishHoliday(
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
