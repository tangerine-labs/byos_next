/**
 * Danish holiday helpers — backed by date-holidays (see holidays.ts).
 * Re-exports kept for existing imports; prefer holidays.ts for new code.
 */
export {
	getDanishHolidayMap,
	getHolidayMap,
	getHolidayName,
	isDanishHoliday,
	isHoliday,
	type HolidayCountry,
	type HolidayInfo,
} from "./holidays";
