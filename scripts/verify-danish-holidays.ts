/**
 * Spot-checks Danish holiday rules (Store Bededag abolition, Easter offsets).
 * Run: pnpm verify:danish-holidays
 */
import {
	getDanishHolidayMap,
	getHolidayName,
	isDanishHoliday,
} from "../app/(app)/recipes/screens/color-calendar/danish-holidays";

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

const m2023 = getDanishHolidayMap(2023);
assert(
	isDanishHoliday(2023, 5, 5, m2023),
	"2023-05-05 should be Store bededag (last year before abolition)",
);
assert(
	getHolidayName(2023, 5, 5, m2023) === "Store bededag",
	"2023-05-05 name",
);

const m2024 = getDanishHolidayMap(2024);
const bededag2024 = [...m2024.entries()].some(([, info]) =>
	info.name.toLowerCase().includes("bededag"),
);
assert(!bededag2024, "2024 must not include Store bededag");

// Easter 2024-03-31 → 2. påskedag on 2024-04-01
assert(
	isDanishHoliday(2024, 4, 1, m2024),
	"2024-04-01 should be 2. påskedag",
);
assert(
	getHolidayName(2024, 4, 1, m2024) === "2. påskedag",
	"2024-04-01 name",
);

// Grundlovsdag and Juleaften (observance days included for this screen)
assert(isDanishHoliday(2024, 6, 5, m2024), "2024-06-05 Grundlovsdag");
assert(isDanishHoliday(2024, 12, 24, m2024), "2024-12-24 Juleaften");

console.log("danish-holidays: all checks passed");
