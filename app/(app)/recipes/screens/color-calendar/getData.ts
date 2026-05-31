import { Temporal } from "@/lib/temporal";
import { getHolidayDates } from "./holidays";

const COPENHAGEN = "Europe/Copenhagen";

/** Preload holiday dates for the visible grid (up to three calendar years). */
export default function getData() {
	const year = Temporal.Now.plainDateISO(COPENHAGEN).year;
	const holidayDatesByYear: Record<number, string[]> = {};

	for (const y of [year - 1, year, year + 1]) {
		holidayDatesByYear[y] = [...getHolidayDates("DK", y)];
	}

	return { holidayDatesByYear };
}
