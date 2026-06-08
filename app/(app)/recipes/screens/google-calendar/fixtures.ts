import type { GoogleEvent } from "@/lib/integrations/google-calendar";
import { Temporal } from "@/lib/temporal";

/**
 * Deterministic fake Google Calendar data for unit tests, Playwright e2e, and
 * local preview without connecting a real Google account.
 *
 * Events are positioned relative to a given week's Monday so the fixture always
 * lands inside the recipe's current-week view. Pass a fixed Monday in unit tests
 * for stable assertions; the recipe passes the live week's Monday so the screen
 * renders populated when GOOGLE_CALENDAR_FIXTURE=true.
 *
 * The shape returned matches what the live path feeds into
 * `assembleCalendarPayload` (one entry per calendar, pre-colour), so both paths
 * exercise the exact same assembly/merge/colour logic.
 */

const TZ = "Europe/Copenhagen";

/** A single calendar's raw events, before colour assignment. */
export type FixtureCalendar = {
	name: string;
	isVacation: boolean;
	events: GoogleEvent[];
};

// Monday-relative day offsets, for readability.
const MON = 0;
const WED = 2;
const THU = 3;
const FRI = 4;
const SUN = 6;

/** A timed event (start.dateTime / end.dateTime in UTC instant form). */
function timed(
	weekStart: Temporal.PlainDate,
	dayOffset: number,
	hour: number,
	minute: number,
	durationMinutes: number,
	summary: string,
	id: string,
): GoogleEvent {
	const start = weekStart.add({ days: dayOffset }).toZonedDateTime({
		timeZone: TZ,
		plainTime: Temporal.PlainTime.from({ hour, minute }),
	});
	const end = start.add({ minutes: durationMinutes });
	return {
		id,
		summary,
		start: { dateTime: start.toInstant().toString(), timeZone: TZ },
		end: { dateTime: end.toInstant().toString(), timeZone: TZ },
		status: "confirmed",
	};
}

/** An all-day event (start.date inclusive, end.date exclusive — Google's shape). */
function allDay(
	weekStart: Temporal.PlainDate,
	startOffset: number,
	endOffsetExclusive: number,
	summary: string,
	id: string,
): GoogleEvent {
	return {
		id,
		summary,
		start: { date: weekStart.add({ days: startOffset }).toString() },
		end: { date: weekStart.add({ days: endOffsetExclusive }).toString() },
		status: "confirmed",
	};
}

/**
 * Build the fixture calendar set for the week beginning `weekStartISO` (a Monday).
 *
 *  - Bjørn (primary):  Training Mon/Wed/Fri mornings; Pokémon GO Fest 2026
 *                      (all-day Fri–Sun); Scouts Wed evening.
 *  - Irena:            Scouts Wed evening (same event → striped two-colour marker).
 *  - Danske helligdage / Svenska helgdagar: a holiday on the same day (Thursday),
 *                      both resolved to red and collapsed into one entry.
 */
export function googleCalendarFixture(weekStartISO: string): FixtureCalendar[] {
	const weekStart = Temporal.PlainDate.from(weekStartISO);

	const bjorn: GoogleEvent[] = [
		timed(weekStart, MON, 6, 30, 60, "Training", "fx-training-mon"),
		timed(weekStart, WED, 6, 30, 60, "Training", "fx-training-wed"),
		timed(weekStart, FRI, 6, 30, 60, "Training", "fx-training-fri"),
		// Friday–Sunday inclusive → end.date is the following Monday (exclusive).
		allDay(weekStart, FRI, SUN + 1, "Pokémon GO Fest 2026", "fx-pogo-fest"),
		timed(weekStart, WED, 18, 0, 90, "Scouts", "fx-scouts-bjorn"),
	];

	const irena: GoogleEvent[] = [
		timed(weekStart, WED, 18, 0, 90, "Scouts", "fx-scouts-irena"),
	];

	const danske: GoogleEvent[] = [
		allDay(weekStart, THU, THU + 1, "Grundlovsdag", "fx-holiday-dk"),
	];

	const svenska: GoogleEvent[] = [
		allDay(weekStart, THU, THU + 1, "Sveriges nationaldag", "fx-holiday-se"),
	];

	return [
		{ name: "Bjørn", isVacation: false, events: bjorn },
		{ name: "Irena", isVacation: false, events: irena },
		{ name: "Danske helligdage", isVacation: false, events: danske },
		{ name: "Svenska helgdagar", isVacation: false, events: svenska },
	];
}
