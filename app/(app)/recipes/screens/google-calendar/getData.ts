import { unstable_cache } from "next/cache";
import {
	getValidAccessToken,
	isCalendarConnected,
	isGoogleOAuthConfigured,
	listCalendars,
	listEvents,
} from "@/lib/integrations/google-calendar";
import { Temporal } from "@/lib/temporal";
import {
	getHolidayDates,
	type HolidayCountry,
} from "../color-calendar/holidays";
import { accentForIndex } from "./tokens";

// Mark dynamic so the renderer always re-evaluates "now" (caching of the actual
// Google network calls is handled explicitly via unstable_cache below).
export const dynamic = "force-dynamic";

const TZ = "Europe/Copenhagen";
const LOCALE = "da-DK";

// ---- Serializable props (no Temporal/Date objects cross the render boundary) ----

export type CalendarEvent = {
	title: string;
	allDay: boolean;
	startLabel: string; // "" for all-day events
	startEpoch: number; // sort key (0 for all-day so they lead the day)
	color: string;
};

export type MonthCell = {
	day: number;
	inMonth: boolean;
	isToday: boolean;
	isHoliday: boolean;
	isWeekend: boolean;
	isVacation: boolean;
};

export type WeekDay = {
	dateStr: string;
	weekdayLabel: string;
	dayNum: number;
	isToday: boolean;
	isHoliday: boolean;
	isWeekend: boolean;
	isVacation: boolean;
	events: CalendarEvent[];
};

export type GoogleCalendarData = {
	connected: boolean;
	configured: boolean;
	monthTitle: string;
	weekdayLabels: string[];
	/** Single-letter weekday initials, Monday-first (M T O T F L S). */
	weekdayInitials: string[];
	monthCells: MonthCell[];
	/** ISO week number for each of the 6 month-grid rows. */
	monthWeeks: number[];
	weekDays: WeekDay[];
	weekNumber: number;
	showWeekNumbers: boolean;
};

type GoogleCalendarParams = {
	vacationCalendar?: string;
	country?: string;
	showWeekNumbers?: boolean | string;
};

// ---- Intl formatters (Danish). Intl needs a Date, so build a UTC-neutral one. ----

const monthYearFormat = new Intl.DateTimeFormat(LOCALE, {
	month: "long",
	year: "numeric",
});
const weekdayShortFormat = new Intl.DateTimeFormat(LOCALE, {
	weekday: "short",
});

function labelDate(d: Temporal.PlainDate): Date {
	return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

/** Monday 2024-01-01 — anchors the Monday-first weekday header order. */
const MONDAY_REF = Temporal.PlainDate.from({ year: 2024, month: 1, day: 1 });
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
	weekdayShortFormat.format(labelDate(MONDAY_REF.add({ days: i }))),
);
const WEEKDAY_INITIALS = WEEKDAY_LABELS.map((label) =>
	label.charAt(0).toUpperCase(),
);

function timeLabel(zdt: Temporal.ZonedDateTime): string {
	// Danish convention uses a dot separator (e.g. 09.30).
	const t = zdt.toPlainTime();
	return `${String(t.hour).padStart(2, "0")}.${String(t.minute).padStart(2, "0")}`;
}

// ---- Pure date helpers (Temporal) ----

const isWeekend = (d: Temporal.PlainDate) => d.dayOfWeek >= 6; // 6=Sat, 7=Sun

function mondayOf(d: Temporal.PlainDate): Temporal.PlainDate {
	return d.subtract({ days: d.dayOfWeek - 1 });
}

function plainEq(a: Temporal.PlainDate, b: Temporal.PlainDate): boolean {
	return Temporal.PlainDate.compare(a, b) === 0;
}

function dayStartInstantISO(d: Temporal.PlainDate): string {
	return d.toZonedDateTime(TZ).toInstant().toString();
}

// ---- Normalized event shape produced by the (cached) network fetch ----

type NormalizedEvent = CalendarEvent & { dateStr: string };

type CalendarPayload = {
	events: NormalizedEvent[];
	vacationDates: string[];
};

/**
 * Expand a Google all-day event (start.date inclusive .. end.date exclusive)
 * into the ISO date strings it covers, clipped to [rangeStart, rangeEndExcl).
 */
function expandAllDay(
	startDate: string,
	endDate: string,
	rangeStart: Temporal.PlainDate,
	rangeEndExcl: Temporal.PlainDate,
): string[] {
	const out: string[] = [];
	let cur = Temporal.PlainDate.from(startDate);
	const end = Temporal.PlainDate.from(endDate);
	// Clip the lower bound forward to the range start.
	if (Temporal.PlainDate.compare(cur, rangeStart) < 0) cur = rangeStart;
	while (
		Temporal.PlainDate.compare(cur, end) < 0 &&
		Temporal.PlainDate.compare(cur, rangeEndExcl) < 0
	) {
		out.push(cur.toString());
		cur = cur.add({ days: 1 });
	}
	return out;
}

function buildCalendarPayloadFetcher() {
	return unstable_cache(
		async (args: {
			userId: string;
			vacationCalendar: string;
			timeMinISO: string;
			timeMaxISO: string;
			rangeStartStr: string;
			rangeEndExclStr: string;
		}): Promise<CalendarPayload> => {
			const accessToken = await getValidAccessToken(args.userId);
			if (!accessToken) {
				// Throwing prevents unstable_cache from caching a transient miss.
				throw new Error("No Google access token");
			}

			const rangeStart = Temporal.PlainDate.from(args.rangeStartStr);
			const rangeEndExcl = Temporal.PlainDate.from(args.rangeEndExclStr);
			const vacationMatch = args.vacationCalendar.trim().toLowerCase();

			const calendars = await listCalendars(accessToken);
			const eventsPerCalendar = await Promise.all(
				calendars.map((cal, index) =>
					listEvents(
						accessToken,
						cal.id,
						args.timeMinISO,
						args.timeMaxISO,
					).then((events) => ({
						events,
						color: accentForIndex(index),
						isVacation:
							vacationMatch.length > 0 &&
							(cal.summary ?? "").toLowerCase().includes(vacationMatch),
					})),
				),
			);

			const out: NormalizedEvent[] = [];
			const vacationDates = new Set<string>();

			for (const group of eventsPerCalendar) {
				for (const ev of group.events) {
					const title = ev.summary?.trim() || "(uden titel)";
					if (ev.start.date) {
						// All-day event.
						const dates = expandAllDay(
							ev.start.date,
							ev.end.date ?? ev.start.date,
							rangeStart,
							rangeEndExcl,
						);
						for (const dateStr of dates) {
							if (group.isVacation) vacationDates.add(dateStr);
							out.push({
								dateStr,
								title,
								allDay: true,
								startLabel: "",
								startEpoch: 0,
								color: group.color,
							});
						}
					} else if (ev.start.dateTime) {
						// Timed event.
						const inst = Temporal.Instant.from(ev.start.dateTime);
						const zdt = inst.toZonedDateTimeISO(TZ);
						out.push({
							dateStr: zdt.toPlainDate().toString(),
							title,
							allDay: false,
							startLabel: timeLabel(zdt),
							startEpoch: inst.epochMilliseconds,
							color: group.color,
						});
					}
				}
			}

			return { events: out, vacationDates: [...vacationDates] };
		},
		["google-calendar-payload"],
		{ revalidate: 300, tags: ["google-calendar"] },
	);
}

const getCachedCalendarPayload = buildCalendarPayloadFetcher();

// ---- Main entry ----

export default async function getData(
	params?: GoogleCalendarParams,
	userId?: string,
): Promise<GoogleCalendarData> {
	const vacationCalendar = params?.vacationCalendar ?? "ferie";
	const showWeekNumbers =
		params?.showWeekNumbers === undefined
			? true
			: params.showWeekNumbers === true || params.showWeekNumbers === "true";

	const today = Temporal.Now.plainDateISO(TZ);
	const displayYear = today.year;
	const displayMonth = today.month;

	// Month overview grid: 6 Monday-first weeks covering the current month.
	const firstOfMonth = Temporal.PlainDate.from({
		year: displayYear,
		month: displayMonth,
		day: 1,
	});
	const monthGridStart = mondayOf(firstOfMonth);
	const monthGridEndExcl = monthGridStart.add({ days: 42 });

	// Detail week: current Monday..Sunday.
	const weekStart = mondayOf(today);
	const weekEndExcl = weekStart.add({ days: 7 });

	// Combined fetch window (month grid always contains the current week, but
	// take the union defensively).
	const rangeStart =
		Temporal.PlainDate.compare(monthGridStart, weekStart) <= 0
			? monthGridStart
			: weekStart;
	const rangeEndExcl =
		Temporal.PlainDate.compare(monthGridEndExcl, weekEndExcl) >= 0
			? monthGridEndExcl
			: weekEndExcl;

	// Holidays for every year the window touches (handles Dec/Jan spillover).
	// Only DK is supported today; the `country` param is reserved for future use.
	const holidayDates = new Set<string>();
	const supportedCountry: HolidayCountry = "DK";
	for (let y = rangeStart.year; y <= rangeEndExcl.year; y++) {
		for (const d of getHolidayDates(supportedCountry, y)) holidayDates.add(d);
	}

	const monthTitle = monthYearFormat.format(labelDate(firstOfMonth));
	const configured = isGoogleOAuthConfigured();

	// Fresh connection check (never cached) so the screen flips to "connected"
	// immediately after the OAuth handshake.
	const connected =
		configured && userId ? await isCalendarConnected(userId) : false;

	let payload: CalendarPayload = { events: [], vacationDates: [] };
	if (connected && userId) {
		try {
			payload = await getCachedCalendarPayload({
				userId,
				vacationCalendar,
				timeMinISO: dayStartInstantISO(rangeStart),
				timeMaxISO: dayStartInstantISO(rangeEndExcl),
				rangeStartStr: rangeStart.toString(),
				rangeEndExclStr: rangeEndExcl.toString(),
			});
		} catch {
			// Leave events empty; the week view simply shows no entries.
			payload = { events: [], vacationDates: [] };
		}
	}

	const vacationSet = new Set(payload.vacationDates);

	const flagsFor = (d: Temporal.PlainDate) => {
		const dateStr = d.toString();
		return {
			isToday: plainEq(d, today),
			isHoliday: holidayDates.has(dateStr),
			isWeekend: isWeekend(d),
			isVacation: vacationSet.has(dateStr),
		};
	};

	// Month overview cells.
	const monthCells: MonthCell[] = [];
	for (let i = 0; i < 42; i++) {
		const d = monthGridStart.add({ days: i });
		monthCells.push({
			day: d.day,
			inMonth: d.year === displayYear && d.month === displayMonth,
			...flagsFor(d),
		});
	}

	// ISO week number for each of the 6 grid rows (the row's Monday).
	const monthWeeks = Array.from(
		{ length: 6 },
		(_, row) => monthGridStart.add({ days: row * 7 }).weekOfYear ?? 0,
	);

	// Group events onto week days.
	const eventsByDate = new Map<string, CalendarEvent[]>();
	for (const ev of payload.events) {
		const list = eventsByDate.get(ev.dateStr) ?? [];
		list.push({
			title: ev.title,
			allDay: ev.allDay,
			startLabel: ev.startLabel,
			startEpoch: ev.startEpoch,
			color: ev.color,
		});
		eventsByDate.set(ev.dateStr, list);
	}

	const weekDays: WeekDay[] = [];
	for (let i = 0; i < 7; i++) {
		const d = weekStart.add({ days: i });
		const dateStr = d.toString();
		const events = (eventsByDate.get(dateStr) ?? []).sort((a, b) => {
			if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
			return a.startEpoch - b.startEpoch;
		});
		weekDays.push({
			dateStr,
			weekdayLabel: WEEKDAY_LABELS[i],
			dayNum: d.day,
			...flagsFor(d),
			events,
		});
	}

	return {
		connected,
		configured,
		monthTitle,
		weekdayLabels: WEEKDAY_LABELS,
		weekdayInitials: WEEKDAY_INITIALS,
		monthCells,
		monthWeeks,
		weekDays,
		weekNumber: today.weekOfYear ?? 0,
		showWeekNumbers,
	};
}
