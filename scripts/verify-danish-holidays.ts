/**
 * Spot-checks Danish holiday rules via date-holidays (Store Bededag abolition, curated set).
 * Run: pnpm verify:danish-holidays
 */
import { getHolidayDates } from "../app/(app)/recipes/screens/color-calendar/holidays";

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

const dk = (year: number) => getHolidayDates("DK", year);

assert(dk(2023).has("2023-05-05"), "2023-05-05 Store Bededag");
assert(!dk(2024).has("2024-05-05"), "2024 has no Store Bededag");
assert(dk(2024).has("2024-04-01"), "2024-04-01 Anden påskedag");
assert(dk(2024).has("2024-06-05"), "2024-06-05 Grundlovsdag");
assert(dk(2024).has("2024-12-24"), "2024-12-24 Juleaften");
assert(!dk(2024).has("2024-05-01"), "2024-05-01 excluded (1. maj)");
assert(!dk(2024).has("2024-02-12"), "2024-02-12 excluded (Fastelavn)");

console.log("danish-holidays: all checks passed");
